/**
 * 复制文本到剪贴板，成功返回 true。
 *
 * 打包后渲染层跑在 file: 源上，navigator.clipboard 在非安全上下文里可能直接不存在，
 * 因此保留 execCommand 兜底；两条路都失败时让调用方给出可操作的提示，而不是静默无反应。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到下面的兜底路径
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', 'true')
    area.style.cssText = 'position:fixed;top:-9999px;opacity:0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
