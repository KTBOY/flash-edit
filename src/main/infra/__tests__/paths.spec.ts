import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { isInsideDir } from '../paths'

const ROOT = process.platform === 'win32' ? 'E:\\games-root' : '/tmp/games-root'
const DOWNLOAD_DIR = join(ROOT, 'games')

describe('isInsideDir', () => {
  it('目录内的文件判定为内部', () => {
    expect(isInsideDir(join(DOWNLOAD_DIR, 'a_100.swf'), DOWNLOAD_DIR)).toBe(true)
    expect(isInsideDir(join(DOWNLOAD_DIR, 'sub', 'a.swf'), DOWNLOAD_DIR)).toBe(true)
  })

  it('目录本身与目录外的文件判定为外部', () => {
    expect(isInsideDir(DOWNLOAD_DIR, DOWNLOAD_DIR)).toBe(false)
    expect(isInsideDir(join(ROOT, 'a.swf'), DOWNLOAD_DIR)).toBe(false)
  })

  it('同前缀的兄弟目录不算内部', () => {
    expect(isInsideDir(join(ROOT, 'games-evil', 'a.swf'), DOWNLOAD_DIR)).toBe(false)
  })

  it.runIf(process.platform === 'win32')('Windows 下大小写与正斜杠混用仍可判定', () => {
    expect(isInsideDir('E:/GAMES-ROOT/GAMES/a.swf', DOWNLOAD_DIR)).toBe(true)
    expect(isInsideDir('E:/games-root/games/../outside.swf', DOWNLOAD_DIR)).toBe(false)
  })
})
