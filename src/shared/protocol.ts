/**
 * swf-file:// 自定义协议的共享定义。
 * 主进程负责注册处理器，渲染进程用 buildSwfFileUrl 构造可 fetch 的地址。
 */
export const SWF_SCHEME = 'swf-file'

/** 由本地绝对路径构造 swf-file:// URL（路径整体 encodeURIComponent，通过查询参数传递） */
export function buildSwfFileUrl(absolutePath: string): string {
  return `${SWF_SCHEME}://local/?p=${encodeURIComponent(absolutePath)}`
}

/** 从 swf-file:// 请求 URL 中还原本地路径（主进程协议处理器使用） */
export function resolveSwfFileUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${SWF_SCHEME}:`) return null
    return parsed.searchParams.get('p')
  } catch {
    return null
  }
}
