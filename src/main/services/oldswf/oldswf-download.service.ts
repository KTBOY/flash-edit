import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import type { OldswfDownloadProgress, OldswfDownloadResult } from '@shared/types'
import { parseOldswfInput, sanitizeFileName } from '@shared/oldswf'
import { logger } from '../../infra/logger'
import { isSwfMagic, parseContentRange, SwfChunkAssembler } from './chunk-assembler'

/**
 * oldswf.com 游戏下载服务（主进程）。
 *
 * oldswf 对游戏 SWF 资源做了 TLS 指纹级别的反爬：curl / Node fetch 等非真实
 * 浏览器客户端一律 404。因此这里用 playwright-core 驱动系统已安装的 Edge/Chrome
 * （真实浏览器网络栈）打开游戏页，让网站自身的分片下载逻辑工作，同时监听所有
 * 网络响应，把 206 分片按 Content-Range 偏移重组为完整 SWF；
 * 分片缺失时兜底从网站写入的 IndexedDB 缓存（swfFiles/blobs）直接提取。
 *
 * 逻辑移植自独立脚本 oldswf-downloader/download_oldswf.js。
 */

const DOWNLOAD_TIMEOUT_MS = 300_000
const PAGE_GOTO_TIMEOUT_MS = 60_000
const TITLE_TIMEOUT_MS = 8_000
const POLL_INTERVAL_MS = 500

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BROWSER_ARGS = ['--disable-blink-features=AutomationControlled']

export class OldswfDownloadCancelledError extends Error {
  constructor() {
    super('下载已取消')
    this.name = 'OldswfDownloadCancelledError'
  }
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

export class OldswfDownloadService {
  private task: Promise<OldswfDownloadResult> | null = null
  private cancelRequested = false
  private abortBrowser: (() => Promise<void>) | null = null

  constructor(
    /** 下载保存目录（userData/games） */
    private readonly gamesDir: string,
    /** 进度回调（由 IPC 层转发给渲染进程） */
    private readonly emitProgress: (progress: OldswfDownloadProgress) => void
  ) {}

  get busy(): boolean {
    return this.task !== null
  }

  /** 取消进行中的下载；无任务返回 false */
  cancel(): boolean {
    if (!this.task) return false
    this.cancelRequested = true
    // 关闭浏览器会中断页面上的所有挂起操作，下载链路随即以取消错误收尾
    this.abortBrowser?.().catch(() => undefined)
    return true
  }

  /** 开始下载（单并发）；进行中再次调用直接拒绝 */
  download(input: string): Promise<OldswfDownloadResult> {
    if (this.task) return Promise.reject(new Error('已有下载任务正在进行，请等待完成或先取消'))
    this.cancelRequested = false
    const task = this.run(input).finally(() => {
      this.task = null
      this.abortBrowser = null
    })
    this.task = task
    return task
  }

  private async run(input: string): Promise<OldswfDownloadResult> {
    const parsed = parseOldswfInput(input)
    if (!parsed) {
      throw new Error('无法识别的游戏地址：应为 https://oldswf.com/game/<ID> 或纯数字游戏 ID')
    }
    const { gameId, pageUrl } = parsed

    this.emit(gameId, 'starting', 0, 0)
    logger.info('oldswf-download', `开始下载游戏 ${gameId}：${pageUrl}`)

    const browser = await launchRealBrowser()
    this.abortBrowser = () => browser.close()
    try {
      return await this.capture(browser, gameId, pageUrl)
    } catch (error) {
      // 浏览器被 cancel 关闭时，playwright 的挂起操作会抛 "Target closed"，统一转为取消语义
      if (this.cancelRequested) throw new OldswfDownloadCancelledError()
      throw error
    } finally {
      this.abortBrowser = null
      await browser.close().catch(() => undefined)
    }
  }

  private async capture(
    browser: Browser,
    gameId: string,
    pageUrl: string
  ): Promise<OldswfDownloadResult> {
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

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_GOTO_TIMEOUT_MS })
    const title = await this.readGameTitle(page, gameId)

    // 主路径：等待分片集齐（网站自身在页面里跑多线程 Range 下载）
    const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS
    let assembled: Uint8Array | null = null
    while (Date.now() < deadline) {
      if (this.cancelRequested) throw new OldswfDownloadCancelledError()
      assembled = assembler.assemble()
      if (assembled) break
      this.emit(
        gameId,
        'downloading',
        assembler.receivedBytes,
        assembler.totalSize,
        assembler.chunkCount
      )
      await page.waitForTimeout(POLL_INTERVAL_MS)
    }

    // 兜底路径：网站下载完成后会把 SWF 存进 IndexedDB，直接从缓存提取
    if (!assembled) {
      if (this.cancelRequested) throw new OldswfDownloadCancelledError()
      logger.warn('oldswf-download', `游戏 ${gameId} 分片监听未集齐，改从页面 IndexedDB 缓存提取`)
      this.emit(
        gameId,
        'extracting',
        assembler.receivedBytes,
        assembler.totalSize,
        assembler.chunkCount
      )
      const swfPath = swfUrlSeen ? new URL(swfUrlSeen).pathname : `/data/game_2024/${gameId}.swf`
      const base64 = await page.evaluate<string | null>(indexedDbExtractExpression(swfPath))
      if (base64) {
        const buffer = Buffer.from(base64, 'base64')
        assembled = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      }
    }

    if (this.cancelRequested) throw new OldswfDownloadCancelledError()
    if (!assembled) {
      throw new Error(
        `下载超时（${DOWNLOAD_TIMEOUT_MS / 1000} 秒内未捕获到完整游戏资源），游戏较大或网络较慢时请重试`
      )
    }
    if (!isSwfMagic(assembled)) {
      throw new Error('下载内容不是合法 SWF（文件头应为 FWS/CWS/ZWS），可能不完整，请重试')
    }

    this.emit(gameId, 'saving', assembled.length, assembled.length, 1)
    const fileName = `${sanitizeFileName(title)}_${gameId}.swf`
    await mkdir(this.gamesDir, { recursive: true })
    const filePath = join(this.gamesDir, fileName)
    await writeFile(filePath, assembled)
    logger.info(
      'oldswf-download',
      `已保存 ${filePath}（${(assembled.length / 1024 / 1024).toFixed(2)} MB，SWF 文件头校验通过）`
    )
    return { gameId, name: fileName, path: filePath, sizeBytes: assembled.length }
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

  private emit(
    gameId: string,
    phase: OldswfDownloadProgress['phase'],
    receivedBytes: number,
    totalBytes: number,
    chunkCount = 0
  ): void {
    this.emitProgress({ gameId, phase, receivedBytes, totalBytes, chunkCount })
  }
}
