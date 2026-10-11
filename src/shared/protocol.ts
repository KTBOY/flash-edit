/**
 * swf-file:// 自定义协议的共享定义。
 * 主进程负责注册处理器，渲染进程用 buildSwfFileUrl 构造可 fetch 的地址。
 */
export const SWF_SCHEME = 'swf-file'

/**
 * 由本地绝对路径构造 swf-file:// URL。
 *
 * 必须**逐段**编码再用 `/` 连接，不能整条 encodeURIComponent：后者会把路径分隔符
 * 也吃掉，整条路径变成单个 URL 段，SWF 内的相对请求（同目录关卡/配置文件）就会
 * 替换掉整段路径而不是只替换文件名，兄弟文件永远解析不出来。
 * 逐段编码后 `.../games/play.swf` + `map1b.swf` → `.../games/map1b.swf`，符合预期。
 */
export function buildSwfFileUrl(absolutePath: string): string {
  const segments = absolutePath.split(/[\\/]/).filter(Boolean)
  return `${SWF_SCHEME}://local/${segments.map(encodeURIComponent).join('/')}`
}

/**
 * 该文件所在目录的 swf-file:// URL（以 `/` 结尾）。
 * 作为 Ruffle 的 config.base，让游戏内 `map1b.swf`、`shell.xml` 这类相对请求
 * 解析到游戏自己的目录，而不是应用页面的目录。
 */
export function buildSwfFileDirUrl(absolutePath: string): string {
  const segments = absolutePath.split(/[\\/]/).filter(Boolean)
  return `${SWF_SCHEME}://local/${segments.slice(0, -1).map(encodeURIComponent).join('/')}/`
}

/**
 * 从 swf-file:// 请求 URL 中还原本地路径（主进程协议处理器使用）。
 * 返回的可能是相对路径——`..` 穿越被 URL 规范化剥掉后就是这样，调用方需自行拒绝。
 */
export function resolveSwfFileUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${SWF_SCHEME}:`) return null
    // 保留 `/` 分隔：existsSync / pathToFileURL / isAbsolute 在 Windows 上都接受正斜杠
    return decodeURIComponent(parsed.pathname.replace(/^\//, '')) || null
  } catch {
    return null
  }
}
