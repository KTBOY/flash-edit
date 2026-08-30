/**
 * oldswf.com 游戏输入解析（纯逻辑，主进程下载服务与渲染层入口引导共用）。
 * 接受游戏页 URL（oldswf.com / oldswf.top）或纯数字游戏 ID。
 */

export interface ParsedOldswfInput {
  /** 纯数字游戏 ID，如 "109087" */
  gameId: string
  /** 游戏页地址 */
  pageUrl: string
}

const GAME_PAGE_RE = /^https?:\/\/oldswf\.(com|top)\/game\/\d+/

/** 解析用户输入；非法输入返回 null。容忍链接带查询串/锚点（分享链接常见） */
export function parseOldswfInput(raw: string): ParsedOldswfInput | null {
  const input = raw.trim()
  if (/^\d+$/.test(input)) {
    return { gameId: input, pageUrl: `https://oldswf.com/game/${input}` }
  }
  if (!GAME_PAGE_RE.test(input)) return null
  try {
    const url = new URL(input)
    const gameId = url.pathname.match(/\/game\/(\d+)$/)?.[1]
    if (!gameId) return null
    return { gameId, pageUrl: `${url.origin}/game/${gameId}` }
  } catch {
    return null
  }
}

/** 用户输入是否指向 oldswf 游戏页（用于「网络加载」入口的引导分流） */
export function isOldswfGamePageUrl(raw: string): boolean {
  return GAME_PAGE_RE.test(raw.trim())
}

/** 文件名清洗：非法字符替换为下划线并限长 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80)
}
