import { describe, expect, it } from 'vitest'
import { isOldswfGamePageUrl, parseOldswfInput, sanitizeFileName } from '@shared/oldswf'

describe('parseOldswfInput', () => {
  it('纯数字 ID', () => {
    expect(parseOldswfInput('109087')).toEqual({
      gameId: '109087',
      pageUrl: 'https://oldswf.com/game/109087'
    })
  })

  it('完整游戏页 URL（com / top 域）', () => {
    expect(parseOldswfInput('https://oldswf.com/game/109087')).toEqual({
      gameId: '109087',
      pageUrl: 'https://oldswf.com/game/109087'
    })
    expect(parseOldswfInput('http://oldswf.top/game/42#top')?.gameId).toBe('42')
  })

  it('容忍首尾空白', () => {
    expect(parseOldswfInput('  109087 \n')?.gameId).toBe('109087')
  })

  it('非法输入返回 null', () => {
    expect(parseOldswfInput('')).toBeNull()
    expect(parseOldswfInput('abc')).toBeNull()
    expect(parseOldswfInput('https://example.com/game/109087')).toBeNull()
    expect(parseOldswfInput('https://oldswf.com/other/109087')).toBeNull()
    expect(parseOldswfInput('ftp://oldswf.com/game/109087')).toBeNull()
  })
})

describe('isOldswfGamePageUrl', () => {
  it('识别游戏页 URL（含带参数/锚点）', () => {
    expect(isOldswfGamePageUrl('https://oldswf.com/game/109087')).toBe(true)
    expect(isOldswfGamePageUrl('https://oldswf.com/game/109087?from=share')).toBe(true)
    expect(isOldswfGamePageUrl('https://oldswf.com/')).toBe(false)
  })

  it('纯数字 ID 不算 URL', () => {
    expect(isOldswfGamePageUrl('109087')).toBe(false)
  })
})

describe('sanitizeFileName', () => {
  it('替换非法字符为下划线', () => {
    expect(sanitizeFileName('闪客快打4:修改版?')).toBe('闪客快打4_修改版_')
  })

  it('限长 80 字符', () => {
    expect(sanitizeFileName('a'.repeat(120)).length).toBe(80)
  })
})
