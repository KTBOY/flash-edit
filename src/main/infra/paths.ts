import { resolve, sep } from 'node:path'

/**
 * 文件是否位于目录内。
 *
 * Windows 路径大小写不敏感，且分隔符可能是 / 或 \，因此两侧都先 resolve 归一化
 * 再比较，并要求必须以分隔符边界开头——避免 .../games-evil 被判定为 .../games 之内。
 * 用于把「删除磁盘文件」限定在下载目录内，防止误删用户其它位置的原始文件。
 */
export function isInsideDir(filePath: string, dir: string): boolean {
  const target = resolve(filePath).toLowerCase()
  const base = resolve(dir).toLowerCase()
  return target.startsWith(base + sep)
}
