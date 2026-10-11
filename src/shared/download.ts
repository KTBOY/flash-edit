/**
 * 多站点下载共用的小工具（纯逻辑，主进程 provider/管理器与渲染层共用）。
 * 站点各自的输入解析放在 oldswf.ts / gamebox.ts 里，这里只放跨站通用的部分。
 */

/** 任务标识：不同站点的游戏 ID 会重号（gamebox/1 与 oldswf/1 不是同一个游戏），故带来源前缀 */
export function downloadTaskId(source: string, gameId: string): string {
  return `${source}:${gameId}`
}

/** 文件名清洗：非法字符替换为下划线并限长 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80)
}
