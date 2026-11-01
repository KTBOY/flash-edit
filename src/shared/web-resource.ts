/**
 * 工具箱 · 网页资源下载：输入识别与页面资源提取（纯逻辑，主进程 service 与测试共用）。
 *
 * 通用解析覆盖 <img>/<video>/<source> 标签、常见视频平台的嵌入 iframe 与
 * 裸视频直链（JS 变量 / Next.js RSC payload）。站点专用规则（gameshare 的
 * 站内 UI 图标过滤）在通用结果上再叠一层过滤，保证新增站点只写过滤函数。
 */

import type { WebResourceInfo, WebResourceKind } from './types'

/** gameshare.cc 及其子域 */
export function isGameshareUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'gameshare.cc' || host.endsWith('.gameshare.cc')
  } catch {
    return false
  }
}

/**
 * gameshare 页面里站内地址只承载 UI 图标（favicon、/images/pan/*.webp 网盘按钮），
 * 真实资源全在外链 CDN 上——把这些噪音滤掉。
 */
export function filterGameshareResources(resources: WebResourceInfo[]): WebResourceInfo[] {
  return resources.filter((resource) => {
    try {
      const u = new URL(resource.url)
      const host = u.hostname.toLowerCase()
      const isSiteSelf = host === 'gameshare.cc' || host.endsWith('.gameshare.cc')
      if (isSiteSelf && (u.pathname.startsWith('/images/') || /\/favicon/i.test(u.pathname))) {
        return false
      }
    } catch {
      return false
    }
    return true
  })
}

/** 从 URL 提取文件名（最后一段路径，decode 后）；取不到返回空串 */
export function fileNameFromUrl(url: string): string {
  try {
    const raw = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    if (!raw) return ''
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  } catch {
    return ''
  }
}

const RESERVED_BASE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Windows 文件名非法字符（含 ASCII 控制字符） */
const FORBIDDEN_CHARS = '\\/:*?"<>|'

/**
 * 清洗为合法的 Windows 文件名：替换非法字符、去掉结尾点/空格、
 * 避开保留设备名、超长时截断但保留扩展名。
 */
export function sanitizeFileName(name: string, fallback = 'resource'): string {
  let cleaned = [...name]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0
      if (code < 0x20 || FORBIDDEN_CHARS.includes(ch)) return '_'
      return ch
    })
    .join('')
    .trim()
  cleaned = cleaned.replace(/[.\s]+$/, '')
  if (!cleaned) cleaned = fallback
  const dot = cleaned.lastIndexOf('.')
  if (RESERVED_BASE.test(dot > 0 ? cleaned.slice(0, dot) : cleaned)) cleaned = `_${cleaned}`
  if (cleaned.length > 120) {
    const ext = dot > 0 ? cleaned.slice(dot) : ''
    cleaned = cleaned.slice(0, Math.max(1, 120 - ext.length)) + ext
  }
  return cleaned
}

const HTML_TEXT_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

function decodeHtmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_TEXT_ENTITIES[m] ?? m)
}

/** 读取标签属性值（支持双引号 / 单引号 / 无引号）；缺失返回 null */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null
}

/**
 * 属性值 → 绝对资源地址：还原 HTML 实体、相对路径按页面地址补全，
 * 仅接受 http/https（data:/javascript: 一律丢弃），非法返回 null。
 */
export function normalizeResourceUrl(raw: string, baseUrl: string): string | null {
  const value = raw.trim().replace(/&amp;/g, '&')
  if (!value || value.startsWith('data:')) return null
  try {
    const u = new URL(value, baseUrl)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** m3u8 是 HLS 播放列表（音视频分离的分片流），拼不成单个可播放文件，归入嵌入类而非直链视频 */
const M3U8_EXT = /\.m3u8(?:[?#]|$)/i
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|flv)(?:[?#]|$)/i

/** 文件名是否已带对应类型的扩展名（没有则保存后无法直接打开，需补一个） */
function hasKindExtension(name: string, kind: WebResourceKind): boolean {
  if (kind === 'image') return /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(name)
  if (kind === 'video') return /\.(mp4|webm|mov|mkv|flv)$/i.test(name)
  // m3u8 的嵌入条目保留原扩展名，避免出现 xxx.m3u8.html
  if (kind === 'embed') return /\.html?$/i.test(name) || /\.m3u8$/i.test(name)
  return /\.[a-z0-9]{1,8}$/i.test(name)
}

/** 视频平台嵌入 iframe 的判定：主机名命中这些域即视为嵌入播放器 */
const EMBED_HOSTS = [
  'youtube.com',
  'youtube-nocookie.com',
  'bilibili.com',
  'bilibili.tv',
  'qq.com',
  'vimeo.com',
  'dailymotion.com',
  'douyin.com',
  'ixigua.com'
]

function isEmbedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return EMBED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/** 资源列表展示顺序：图片在前，视频其次，嵌入与文件殿后；组内保持出现顺序 */
const KIND_ORDER: Record<WebResourceKind, number> = { image: 0, video: 1, embed: 2, file: 3 }

/**
 * 从页面 HTML 提取全部可识别资源，按出现顺序去重。
 * 相对路径基于 baseUrl 补全；解析出的 fileName 已清洗为合法 Windows 文件名。
 */
export function extractWebResources(html: string, baseUrl: string): WebResourceInfo[] {
  // RSC payload / JSON 里的地址常被转义（\/、\u002F、\u0026），先还原再扫裸直链
  const flat = html
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')

  const found: WebResourceInfo[] = []
  const seen = new Set<string>()
  const push = (kind: WebResourceKind, rawUrl: string, coverUrl?: string): void => {
    const url = normalizeResourceUrl(rawUrl, baseUrl)
    if (!url || seen.has(url)) return
    seen.add(url)
    const base = fileNameFromUrl(url)
    const ext =
      kind === 'image' ? '.jpg' : kind === 'video' ? '.mp4' : kind === 'embed' ? '.html' : '.bin'
    let fileName = base
      ? sanitizeFileName(base)
      : sanitizeFileName(`resource_${found.length + 1}${ext}`)
    // 扩展名缺失的资源（如 /download?id=1）按类型补一个，保存后才能直接打开
    if (!hasKindExtension(fileName, kind)) fileName = sanitizeFileName(`${fileName}${ext}`)
    found.push({ kind, url, fileName, sizeBytes: 0, coverUrl: coverUrl || undefined })
  }

  // <img>：src 优先，data-src（懒加载）次之，srcset 取第一个候选
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const text = tag[0]
    const src = attr(text, 'src') ?? attr(text, 'data-src')
    if (src) push('image', src)
    const srcset = attr(text, 'srcset') ?? attr(text, 'data-srcset')
    const first = srcset?.split(',')[0]?.trim().split(/\s+/)[0]
    if (first) push('image', first)
  }

  // <video> 与其 <source> 子元素；HLS 播放列表归入嵌入（拿不到单文件直链）
  for (const tag of flat.matchAll(/<(?:video|source)\b[^>]*>/gi)) {
    const src = attr(tag[0], 'src')
    if (!src) continue
    push(M3U8_EXT.test(src) ? 'embed' : 'video', src)
  }

  // 嵌入播放器 iframe：仅收录已知视频平台，避免把广告/统计 iframe 当资源
  for (const tag of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const src = attr(tag[0], 'src')
    if (!src) continue
    const url = normalizeResourceUrl(src, baseUrl)
    if (url && isEmbedHost(url)) push('embed', url)
  }

  // 裸视频直链（脚本变量、RSC payload）；m3u8 播放列表归入嵌入
  for (const m of flat.matchAll(/https?:\/\/[^\s"'<>()[\]{}\\]+/gi)) {
    const raw = m[0]
    if (M3U8_EXT.test(raw)) push('embed', raw)
    else if (VIDEO_EXT.test(raw)) push('video', raw)
  }

  return found
    .filter((r) => !/\/favicon/i.test(r.url) && !/\.svg(?:[?#]|$)/i.test(r.url))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/** 页面 <title> 文本（已还原 HTML 实体、去首尾空白）；取不到返回空串 */
export function extractPageTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? ''
  return decodeHtmlText(raw).trim()
}
