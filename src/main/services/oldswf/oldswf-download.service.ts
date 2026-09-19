import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { OldswfDownloadPhase, OldswfDownloadResult, OldswfDownloadTask } from '@shared/types'
import { parseOldswfInput, sanitizeFileName } from '@shared/oldswf'
import { logger } from '../../infra/logger'
import { isSwfMagic, parseContentRange, SwfChunkAssembler } from './chunk-assembler'

/**
 * oldswf.com 游戏下载服务（主进程，多任务队列）。
 *
 * oldswf 对游戏 SWF 资源做了 TLS 指纹级别的反爬：curl / Node fetch 等非真实
 * 浏览器客户端一律 404。因此这里用 playwright-core 驱动系统已安装的 Edge/Chrome
 * （真实浏览器网络栈）打开游戏页，让网站自身的分片下载逻辑工作，同时监听所有
 * 网络响应，把 206 分片按 Content-Range 偏移重组为完整 SWF；
 * 分片缺失时兜底从网站写入的 IndexedDB 缓存（swfFiles/blobs）直接提取。
 *
 * 队列：每个任务独占一个无头浏览器会话，最多 MAX_CONCURRENT 个并行，其余 FIFO 排队。
 * 任务表是本进程唯一事实来源，状态与进度都推送给渲染层，
 * 因此面板切走再回来仍能对上进度。
 *
 * 逻辑移植自独立脚本 oldswf-downloader/download_oldswf.js。
 */

const DOWNLOAD_TIMEOUT_MS = 300_000
const PAGE_GOTO_TIMEOUT_MS = 60_000
const TITLE_TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 500

/** 同时进行的下载任务上限（每个任务一个无头浏览器） */
const MAX_CONCURRENT = 3

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BROWSER_ARGS = ['--disable-blink-features=AutomationControlled']

export class OldswfDownloadCancelledError extends Error {
  constructor() {
    super('下载已取消')
    this.name = 'OldswfDownloadCancelledError'
  }
}

/** 运行期上下文：取消标记与浏览器关闭句柄按任务隔离 */
interface TaskContext {
  readonly task: OldswfDownloadTask
  cancelRequested: boolean
  closeBrowser: (() => Promise<void>) | null
  /** 已从任务表移除：不再对外推送事件，避免迟到的进度把该行"复活" */
  removed: boolean
}

/** 启动系统真实浏览器（优先 Edge，其次 Chrome，最后回退 playwright 自带内核） */
async function launchRealBrowser(): Promise<Browser> {
  const failures: string[] = []
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ headless: true, channel, args: BROWSER_ARGS })
    } catch (error) {
      failures.push(`${channel}：${firstLine(error)}`)
    }
  }
  try {
    return await chromium.launch({ headless: true, args: BROWSER_ARGS })
  } catch (error) {
    failures.push(`chromium：${firstLine(error)}`)
    throw new Error(
      `未找到可用的浏览器（需要系统安装 Microsoft Edge 或 Chrome）。尝试记录：${failures.join('；')}`
    )
  }
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? ''
}

/**
 * 从页面 IndexedDB（swfFiles → blobs）提取 SWF 的浏览器端脚本。
 * blob → base64 分块转换，避免大文件按字节数组走序列化的开销。
 * 以字符串形式交给 page.evaluate：主进程 tsconfig 无 DOM lib，内联脚本不参与类型检查。
 */
function indexedDbExtractExpression(swfPath: string): string {
  return [
    '(async () => {',
    '  const KEY = ' + JSON.stringify(swfPath) + ';',
    '  const open = () => new Promise((res, rej) => {',
    '    const r = indexedDB.open("swfFiles");',
    '    r.onsuccess = () => res(r.result);',
    '    r.onerror = () => rej(r.error);',
    '  });',
    '  const read = (db) => new Promise((res, rej) => {',
    '    const req = db.transaction("blobs", "readonly").objectStore("blobs").get(KEY);',
    '    req.onsuccess = () => res(req.result);',
    '    req.onerror = () => rej(req.error);',
    '  });',
    '  try {',
    '    const rec = await read(await open());',
    '    if (!rec) return null;',
    '    const blob = rec.data || rec.blob || rec;',
    '    const bytes = new Uint8Array(await blob.arrayBuffer());',
    '    let binary = "";',
    '    for (let i = 0; i < bytes.length; i += 0x8000) {',
    '      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));',
    '    }',
    '    return btoa(binary);',
    '  } catch {',
    '    return null;',
    '  }',
    '})()'
  ].join('\n')
}

function isTerminal(status: OldswfDownloadTask['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

export class OldswfDownloadManager {
  private readonly tasks = new Map<string, TaskContext>()
  private readonly queue: string[] = []
  private runningCount = 0

  constructor(
    /** 下载保存目录取值器（用户可在设置中修改，未设置时回退 userData/games） */
    private readonly getGamesDir: () => string,
    /** 任务快照推送（由 IPC 层转发给渲染进程） */
    private readonly emitTask: (task: OldswfDownloadTask) => void,
    /**
     * 落盘成功回调：主进程据此直接登记游戏库，
     * 用户不必等游戏被载入，多任务下载时记录也不会丢。
     * hash 为文件内容 sha256，与渲染层载入同一文件时算出的哈希一致。
     */
    private readonly onSaved: (result: OldswfDownloadResult, hash: string) => void
  ) {}

  /** 全部任务快照（含已结束），按创建时间倒序 */
  list(): OldswfDownloadTask[] {
    return [...this.tasks.values()]
      .map((ctx) => ({ ...ctx.task }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 提交下载任务。同一游戏 ID 仍在排队或下载中时拒绝；
   * 已结束的同 ID 任务就地复用槽位重跑（即「重试」）。
   */
  start(input: string): OldswfDownloadTask {
    const parsed = parseOldswfInput(input)
    if (!parsed) {
      throw new Error('无法识别的游戏地址：应为 https://oldswf.com/game/<ID> 或纯数字游戏 ID')
    }
    const existing = this.tasks.get(parsed.gameId)
    if (existing && !isTerminal(existing.task.status)) {
      throw new Error(`游戏 ${parsed.gameId} 已在下载队列中`)
    }

    const task: OldswfDownloadTask = {
      gameId: parsed.gameId,
      input: input.trim(),
      status: 'queued',
      phase: null,
      receivedBytes: 0,
      totalBytes: 0,
      chunkCount: 0,
      result: null,
      error: null,
      createdAt: existing?.task.createdAt ?? Date.now()
    }
    const ctx: TaskContext = { task, cancelRequested: false, closeBrowser: null, removed: false }
    this.tasks.set(task.gameId, ctx)
    this.queue.push(task.gameId)
    this.publish(ctx)
    this.pump()
    return { ...task }
  }

  /** 取消指定任务：排队中直接出队，下载中关闭其浏览器会话 */
  cancel(gameId: string): boolean {
    const ctx = this.tasks.get(gameId)
    if (!ctx || isTerminal(ctx.task.status)) return false

    const queuedAt = this.queue.indexOf(gameId)
    if (queuedAt >= 0) {
      this.queue.splice(queuedAt, 1)
      ctx.cancelRequested = true
      this.finish(ctx, 'canceled')
      return true
    }
    ctx.cancelRequested = true
    // 关闭浏览器会中断该页面上的所有挂起操作，下载链路随即以取消错误收尾
    ctx.closeBrowser?.().catch(() => undefined)
    return true
  }

  /**
   * 从任务表移除指定任务（只影响列表，不动游戏库与磁盘文件）。
   * 仍在排队或下载中的任务先走取消流程，再删除记录。
   */
  remove(gameIds: string[]): void {
    for (const gameId of gameIds) {
      const ctx = this.tasks.get(gameId)
      if (!ctx) continue
      ctx.removed = true
      this.cancel(gameId)
      this.tasks.delete(gameId)
    }
  }

  /** 有空闲并发额度就派发排队任务 */
  private pump(): void {
    while (this.runningCount < MAX_CONCURRENT && this.queue.length > 0) {
      const gameId = this.queue.shift()
      if (!gameId) return
      const ctx = this.tasks.get(gameId)
      if (!ctx || ctx.task.status !== 'queued') continue
      this.runningCount += 1
      void this.run(ctx).finally(() => {
        this.runningCount -= 1
        this.pump()
      })
    }
  }

  private async run(ctx: TaskContext): Promise<void> {
    ctx.task.status = 'running'
    this.publish(ctx)
    logger.info('oldswf-download', `开始下载游戏 ${ctx.task.gameId}`)

    let browser: Browser
    try {
      browser = await launchRealBrowser()
    } catch (error) {
      this.finish(ctx, 'failed', firstLine(error))
      return
    }
    ctx.closeBrowser = () => browser.close()
    try {
      const captured = await this.capture(ctx, browser)
      this.onSaved(captured.result, captured.hash)
      this.finish(ctx, 'succeeded', null, captured.result)
    } catch (error) {
      if (ctx.cancelRequested || error instanceof OldswfDownloadCancelledError) {
        this.finish(ctx, 'canceled')
      } else {
        this.finish(ctx, 'failed', firstLine(error))
      }
    } finally {
      ctx.closeBrowser = null
      await browser.close().catch(() => undefined)
    }
  }

  private async capture(
    ctx: TaskContext,
    browser: Browser
  ): Promise<{ result: OldswfDownloadResult; hash: string }> {
    const parsed = parseOldswfInput(ctx.task.input)
    if (!parsed) throw new Error('无法识别的游戏地址')
    const { gameId } = ctx.task

    const page = await browser.newPage({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 800 }
    })
    const assembler = new SwfChunkAssembler()
    let swfUrlSeen: string | null = null

    const isGameSwf = (url: string): boolean =>
      /\/data\/game_[^/]+\/\d+\.swf/.test(url) && url.includes(`/${gameId}.swf`)

    page.on('response', (resp) => {
      void (async () => {
        try {
          const url = resp.url()
          if (!isGameSwf(url)) return
          swfUrlSeen = url
          const status = resp.status()
          if (status !== 200 && status !== 206) return
          const body = await resp.body()
          const contentRange = resp.headers()['content-range']
          if (status === 200 || !contentRange) {
            assembler.setFullBody(body)
          } else {
            const range = parseContentRange(contentRange)
            if (range) assembler.addChunk(range.start, body, range.total)
          }
        } catch {
          /* 响应体读取竞态（跳转/中断）时忽略该分片，由 IndexedDB 兜底补齐 */
        }
      })()
    })

    this.setProgress(ctx, 'starting')
    await page.goto(parsed.pageUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_GOTO_TIMEOUT_MS })
    const title = await this.readGameTitle(page, gameId)

    // 主路径：等待分片集齐（网站自身在页面里跑多线程 Range 下载）
    const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS
    let assembled: Uint8Array | null = null
    while (Date.now() < deadline) {
      if (ctx.cancelRequested) throw new OldswfDownloadCancelledError()
      assembled = assembler.assemble()
      if (assembled) break
      this.setProgress(ctx, 'downloading', {
        receivedBytes: assembler.receivedBytes,
        totalBytes: assembler.totalSize,
        chunkCount: assembler.chunkCount
      })
      await page.waitForTimeout(POLL_INTERVAL_MS)
    }

    // 兜底路径：网站下载完成后会把 SWF 存进 IndexedDB，直接从缓存提取
    if (!assembled) {
      if (ctx.cancelRequested) throw new OldswfDownloadCancelledError()
      logger.warn('oldswf-download', `游戏 ${gameId} 分片监听未集齐，改从页面 IndexedDB 缓存提取`)
      this.setProgress(ctx, 'extracting')
      const swfPath = swfUrlSeen ? new URL(swfUrlSeen).pathname : `/data/game_2024/${gameId}.swf`
      const base64 = await page.evaluate<string | null>(indexedDbExtractExpression(swfPath))
      if (base64) {
        const buffer = Buffer.from(base64, 'base64')
        assembled = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      }
    }

    if (ctx.cancelRequested) throw new OldswfDownloadCancelledError()
    if (!assembled) {
      throw new Error(
        `下载超时（${DOWNLOAD_TIMEOUT_MS / 1000} 秒内未捕获到完整游戏资源），游戏较大或网络较慢时请重试`
      )
    }
    if (!isSwfMagic(assembled)) {
      throw new Error('下载内容不是合法 SWF（文件头应为 FWS/CWS/ZWS），可能不完整，请重试')
    }

    this.setProgress(ctx, 'saving', {
      receivedBytes: assembled.length,
      totalBytes: assembled.length
    })
    const fileName = `${sanitizeFileName(title)}_${gameId}.swf`
    const gamesDir = this.getGamesDir()
    await mkdir(gamesDir, { recursive: true })
    const filePath = join(gamesDir, fileName)
    await writeFile(filePath, assembled)
    logger.info(
      'oldswf-download',
      `已保存 ${filePath}（${(assembled.length / 1024 / 1024).toFixed(2)} MB，SWF 文件头校验通过）`
    )
    return {
      result: { gameId, name: fileName, path: filePath, sizeBytes: assembled.length },
      hash: createHash('sha256').update(Buffer.from(assembled)).digest('hex')
    }
  }

  /** 从游戏页 h3 标题取游戏名，取不到用默认名 */
  private async readGameTitle(page: Page, gameId: string): Promise<string> {
    const fallback = `oldswf_${gameId}`
    try {
      const text = await page.locator('h3').first().textContent({ timeout: TITLE_TIMEOUT_MS })
      return text?.trim() || fallback
    } catch {
      return fallback
    }
  }

  private setProgress(
    ctx: TaskContext,
    phase: OldswfDownloadPhase,
    bytes?: { receivedBytes: number; totalBytes: number; chunkCount?: number }
  ): void {
    ctx.task.phase = phase
    if (bytes) {
      ctx.task.receivedBytes = bytes.receivedBytes
      ctx.task.totalBytes = bytes.totalBytes
      ctx.task.chunkCount = bytes.chunkCount ?? ctx.task.chunkCount
    }
    this.publish(ctx)
  }

  /** 收尾：写入终态并推送 */
  private finish(
    ctx: TaskContext,
    status: 'succeeded' | 'failed' | 'canceled',
    error: string | null = null,
    result: OldswfDownloadResult | null = null
  ): void {
    ctx.task.status = status
    ctx.task.error = error
    ctx.task.result = result
    if (result) {
      ctx.task.receivedBytes = result.sizeBytes
      ctx.task.totalBytes = result.sizeBytes
      ctx.task.phase = 'saving'
    }
    this.publish(ctx)
    if (error) logger.warn('oldswf-download', `游戏 ${ctx.task.gameId} 下载失败：${error}`)
  }

  private publish(ctx: TaskContext): void {
    if (ctx.removed) return
    this.emitTask({ ...ctx.task })
  }
}
