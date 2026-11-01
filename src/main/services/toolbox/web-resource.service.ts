import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  WebResourceDownloadInput,
  WebResourceDownloadProgress,
  WebResourceDownloadResult,
  WebResourceInfo,
  WebResourceParseResult
} from '@shared/types'
import {
  extractPageTitle,
  extractWebResources,
  filterGameshareResources,
  isGameshareUrl,
  sanitizeFileName
} from '@shared/web-resource'
import { pickResourceSavePath } from '../dialog.service'
import { logger } from '../../infra/logger'

/**
 * 工具箱 · 网页资源下载。
 *
 * 解析：抓取页面 HTML，按站点解析器（gameshare 精确过滤 / 通用网页兜底）
 * 提取图片与视频资源，交渲染层展示；站点差异全部收敛在 filter 一层，
 * 新增站点只需在 SITES 注册表里加一个条目。
 * 下载：单文件流式落盘（视频可能数百 MB，不整份进内存），
 * Referer 带资源所属页面地址过防盗链，进度经事件通道推送，可随时取消；
 * 取消或失败时清掉半截文件，避免留下打不开的残骸。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const PAGE_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 600_000
/** 进度上报节流间隔 */
const PROGRESS_INTERVAL_MS = 200

/** 用户主动取消下载时抛出，start 据此把结果标记为 canceled 而非失败 */
class WebResourceCancelledError extends Error {
  constructor() {
    super('下载已取消')
    this.name = 'WebResourceCancelledError'
  }
}

interface SiteParser {
  id: string
  /** auto 模式下按域名认领页面；generic 恒真作为兜底 */
  match(url: URL): boolean
  /** 通用提取结果之上的站点过滤（剔除 UI 图标等噪音） */
  filter(resources: WebResourceInfo[]): WebResourceInfo[]
}

const GAMESHARE_SITE: SiteParser = {
  id: 'gameshare',
  match: (url) => isGameshareUrl(url.href),
  filter: filterGameshareResources
}

const GENERIC_SITE: SiteParser = {
  id: 'generic',
  match: () => true,
  filter: (resources) => resources
}

/** 站点注册表：专用站点在前，generic 兜底必须殿后 */
const SITES = [GAMESHARE_SITE, GENERIC_SITE]

function resolveSite(siteId: string, url: URL): SiteParser {
  if (siteId === 'gameshare') return GAMESHARE_SITE
  if (siteId === 'generic') return GENERIC_SITE
  return SITES.find((site) => site.id !== 'generic' && site.match(url)) ?? GENERIC_SITE
}

/** 校验为 http/https 绝对地址；非法直接抛错（错误信息会显示在渲染层 toast） */
function assertHttpUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new Error('请输入有效的网页地址（以 http:// 或 https:// 开头）')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('仅支持 http/https 网页地址')
  }
  return parsed
}

/** 校验下载入参（IPC 传来的 unknown 对象），非法字段直接抛错 */
function assertDownloadInput(raw: unknown): WebResourceDownloadInput {
  if (typeof raw !== 'object' || raw === null) throw new Error('下载参数不合法')
  const input = raw as Record<string, unknown>
  const url = assertHttpUrl(typeof input.url === 'string' ? input.url : '').href
  const defaultName =
    typeof input.defaultName === 'string' && input.defaultName.trim()
      ? input.defaultName.trim()
      : ''
  if (!defaultName) throw new Error('保存文件名缺失')
  const referer =
    typeof input.referer === 'string' && input.referer.trim() ? input.referer.trim() : undefined
  const outputDir =
    typeof input.outputDir === 'string' && input.outputDir.trim() ? input.outputDir.trim() : undefined
  return { url, referer, defaultName, outputDir }
}

/** 带超时与外部取消的 fetch：超时/取消都表现为 AbortError（范本 gamebox-provider） */
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  outer?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const relay = (): void => controller.abort()
  outer?.addEventListener('abort', relay)
  try {
    return await fetch(url, { headers, signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', relay)
  }
}

/** 删除取消/失败留下的半截文件；不存在等错误静默忽略 */
async function removeQuietly(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    /* 文件不存在或被占用：忽略 */
  }
}

/**
 * 网页资源下载服务。progressPusher 由 ipc-register 注入（主窗口可能尚未就绪，
 * 推送时自行判空）。
 */
export class WebResourceService {
  /** 进行中的下载，取消时按 downloadId 中断 */
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly pushProgress: (progress: WebResourceDownloadProgress) => void
  ) {}

  /** 解析页面资源列表；siteId 见 WebResourceSiteId，'auto' 按域名识别 */
  async parse(siteId: string, rawUrl: string): Promise<WebResourceParseResult> {
    const url = assertHttpUrl(rawUrl)
    const site = resolveSite(siteId, url)
    const resp = await fetchWithTimeout(
      url.href,
      { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
      PAGE_TIMEOUT_MS
    )
    if (!resp.ok) {
      throw new Error(`页面读取失败（HTTP ${resp.status}），请确认地址仍然有效`)
    }
    const html = await resp.text()
    const resources = site.filter(extractWebResources(html, url.href))
    logger.info('toolbox', `网页资源解析 ${url.href} → ${resources.length} 个资源（${site.id}）`)
    return { siteId: site.id, pageTitle: extractPageTitle(html), pageUrl: url.href, resources }
  }

  /**
   * 下载单个资源，resolve 于下载结束。outputDir 缺省时先弹另存为对话框
   * （用户取消返回 null）；失败抛错；用户取消下载返回 canceled: true。
   */
  async start(
    parent: BrowserWindow | null,
    rawInput: unknown
  ): Promise<WebResourceDownloadResult | null> {
    const input = assertDownloadInput(rawInput)
    let savePath: string
    if (input.outputDir) {
      savePath = join(input.outputDir, sanitizeFileName(input.defaultName))
    } else {
      const picked = await pickResourceSavePath(parent, sanitizeFileName(input.defaultName))
      if (!picked) return null
      savePath = picked
    }

    const downloadId = randomUUID()
    const controller = new AbortController()
    this.active.set(downloadId, controller)
    const base = { downloadId, url: input.url }
    try {
      this.pushProgress({ ...base, receivedBytes: 0, totalBytes: 0, status: 'downloading' })
      const sizeBytes = await this.streamToFile({
        url: input.url,
        referer: input.referer,
        savePath,
        signal: controller.signal,
        downloadId
      })
      this.pushProgress({
        ...base,
        receivedBytes: sizeBytes,
        totalBytes: sizeBytes,
        status: 'succeeded'
      })
      logger.info(
        'toolbox',
        `网页资源已下载：${savePath}（${(sizeBytes / 1024 / 1024).toFixed(2)} MB）`
      )
      return { downloadId, savePath, sizeBytes, canceled: false }
    } catch (error) {
      await removeQuietly(savePath)
      if (error instanceof WebResourceCancelledError || controller.signal.aborted) {
        this.pushProgress({ ...base, receivedBytes: 0, totalBytes: 0, status: 'canceled' })
        return { downloadId, savePath, sizeBytes: 0, canceled: true }
      }
      const message = error instanceof Error ? error.message : String(error)
      this.pushProgress({ ...base, receivedBytes: 0, totalBytes: 0, status: 'failed', error: message })
      throw error instanceof Error ? error : new Error(message)
    } finally {
      this.active.delete(downloadId)
    }
  }

  /** 取消进行中的下载；downloadId 无对应任务返回 false */
  cancel(downloadId: string): boolean {
    const controller = this.active.get(downloadId)
    if (!controller) return false
    controller.abort()
    return true
  }

  /** 流式落盘并按节流间隔上报进度，返回落盘字节数 */
  private async streamToFile(args: {
    url: string
    referer?: string
    savePath: string
    signal: AbortSignal
    downloadId: string
  }): Promise<number> {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*' }
    // 防盗链站点（对象存储类）只认资源所属页面的 Referer，缺它一律 403
    if (args.referer) headers.Referer = args.referer
    const resp = await fetchWithTimeout(args.url, headers, DOWNLOAD_TIMEOUT_MS, args.signal)
    if (!resp.ok || !resp.body) {
      throw new Error(
        `资源读取失败（HTTP ${resp.status}）。带 Referer 仍被拒时通常是站点调整了防盗链`
      )
    }
    const total = Number(resp.headers.get('content-length')) || 0
    await mkdir(dirname(args.savePath), { recursive: true })
    const handle = await open(args.savePath, 'w')
    let received = 0
    let lastEmit = 0
    try {
      for await (const part of resp.body as AsyncIterable<Uint8Array>) {
        if (args.signal.aborted) throw new WebResourceCancelledError()
        const chunk = part instanceof Uint8Array ? part : new Uint8Array(part as ArrayBuffer)
        await handle.write(chunk)
        received += chunk.length
        const now = Date.now()
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now
          this.pushProgress({
            downloadId: args.downloadId,
            url: args.url,
            receivedBytes: received,
            totalBytes: total,
            status: 'downloading'
          })
        }
      }
    } finally {
      await handle.close()
    }
    return received
  }
}
