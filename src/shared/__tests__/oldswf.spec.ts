import { describe, expect, it } from 'vitest'
import {
  extractGameTitle,
  extractSwfPath,
  isOldswfGamePageUrl,
  parseOldswfInput,
  sanitizeFileName
} from '@shared/oldswf'

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

describe('extractSwfPath', () => {
  const page = (literal: string): string =>
    `<script>var swfBaseUrl = "/data/extra/x/";(function f(){typeof loadSwf==='function'?loadSwf("${literal}"):setTimeout(f,100)})();</script>`

  it('实测的三种目录写法都能取到，且不依赖文件名等于游戏 ID', () => {
    // 202914 → game.swf；100 → 13278.swf；30000 → 21309.swf
    expect(extractSwfPath(page('/data/extra/mxwsbcqwdb/game.swf'))).toBe(
      '/data/extra/mxwsbcqwdb/game.swf'
    )
    expect(extractSwfPath(page('/data/game/13278.swf'))).toBe('/data/game/13278.swf')
    expect(extractSwfPath(page('/data/swf/21309.swf'))).toBe('/data/swf/21309.swf')
  })

  it('容忍绝对地址与查询串，只保留 pathname', () => {
    expect(extractSwfPath(page('https://oldswf.com/data/game/9.swf?x=1'))).toBe(
      '/data/game/9.swf'
    )
  })

  it('页面无 loadSwf / 非 swf 资源时返回 null（交给浏览器兜底）', () => {
    expect(extractSwfPath('<html>没有资源</html>')).toBeNull()
    expect(extractSwfPath(page('/data/extra/x/preview.mp3'))).toBeNull()
  })
})

describe('extractGameTitle', () => {
  it('取 h3 中的游戏名', () => {
    expect(extractGameTitle('<h3>\n  冒险王之神兵传奇   </h3>')).toBe('冒险王之神兵传奇')
  })

  it('缺失或空标题返回 null', () => {
    expect(extractGameTitle('<h3>   </h3>')).toBeNull()
    expect(extractGameTitle('<p>x</p>')).toBeNull()
  })
})
