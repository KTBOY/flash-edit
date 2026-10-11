import { describe, expect, it } from 'vitest';
import {
  extractGameboxSwfUrl,
  extractGameboxTitle,
  parseGameboxInput
} from '@shared/gamebox';
import { parseOldswfInput } from '@shared/oldswf';

const PREFIX = 'https://nbg1.your-objectstorage.com/gamebox';

/** 按 2026-10 实测的 game/8067 页面结构还原：路径实参 + 页内前缀 */
function gamePage(swfArg: string, prefix = PREFIX): string {
  return [
    '<html><head><title>細菌大戰 - GameBox</title></head><body>',
    '<h1 class="font-orbitron text-2xl gradient-text">GameBox</h1>',
    '<h1 class="font-orbitron text-4xl gradient-text">細菌大戰</h1>',
    '<script>',
    'function ensureStorageUrl(url) { try { new URL(url); return url; } catch {',
    "  const prefix = '" + prefix + "';",
    '  return url.startsWith("/") ? prefix + url : `${prefix}/${url}`;',
    '}}',
    'function getGameSwfUrl() { return ensureStorageUrl("' + swfArg + '"); }',
    'const script = document.createElement("script");',
    "script.src = 'https://unpkg.com/@ruffle-rs/ruffle';",
    '</script></body></html>'
  ].join('\n');
}

describe('parseGameboxInput', () => {
  it('纯数字 ID', () => {
    expect(parseGameboxInput('8067')).toEqual({
      gameId: '8067',
      pageUrl: 'https://www.gamebox.tw/game/8067'
    });
  });

  it('完整游戏页 URL，去掉查询串/锚点并归一化到 www 域', () => {
    expect(parseGameboxInput('https://www.gamebox.tw/game/8067')).toEqual({
      gameId: '8067',
      pageUrl: 'https://www.gamebox.tw/game/8067'
    });
    expect(parseGameboxInput('http://gamebox.tw/game/8067?from=share#play')?.gameId).toBe('8067');
    expect(parseGameboxInput('https://www.gamebox.tw/game/8067?x=1')?.pageUrl).toBe(
      'https://www.gamebox.tw/game/8067'
    );
  });

  it('容忍首尾空白', () => {
    expect(parseGameboxInput('  https://www.gamebox.tw/game/8067 \n')?.gameId).toBe('8067');
  });

  it('非法输入返回 null', () => {
    expect(parseGameboxInput('')).toBeNull();
    expect(parseGameboxInput('abc')).toBeNull();
    expect(parseGameboxInput('https://www.gamebox.tw/category/8067')).toBeNull();
    expect(parseGameboxInput('ftp://www.gamebox.tw/game/8067')).toBeNull();
  });

  it('两个站点的入口互不认领对方的地址', () => {
    expect(parseGameboxInput('https://oldswf.com/game/109087')).toBeNull();
    expect(parseOldswfInput('https://www.gamebox.tw/game/8067')).toBeNull();
  });
});

describe('extractGameboxSwfUrl', () => {
  it('实测页面：根相对路径接回页内对象存储前缀', () => {
    expect(extractGameboxSwfUrl(gamePage('/swf/celue/1763648330019.swf'))).toBe(
      'https://nbg1.your-objectstorage.com/gamebox/swf/celue/1763648330019.swf'
    );
  });

  it('路径不带前导斜杠时补一个分隔符', () => {
    expect(extractGameboxSwfUrl(gamePage('swf/2026/123.swf'))).toBe(`${PREFIX}/swf/2026/123.swf`);
  });

  it('页面直接给绝对地址时原样使用', () => {
    const url = 'https://nbg1.your-objectstorage.com/gamebox/swf/2025/99.swf';
    expect(extractGameboxSwfUrl(gamePage(url))).toBe(url);
  });

  it('页内前缀换掉时按页面给的来（不写死域名）', () => {
    const mirror = 'https://mirror.example.org/box';
    expect(extractGameboxSwfUrl(gamePage('/swf/a.swf', mirror))).toBe(`${mirror}/swf/a.swf`);
  });

  it('结构变化时退回：绝对资源地址 → 根相对路径接回站点域名', () => {
    expect(
      extractGameboxSwfUrl('<p>src="https://cdn.other.example/x/game.swf"</p>')
    ).toBe('https://cdn.other.example/x/game.swf');
    expect(extractGameboxSwfUrl('<p>src="/swf/legacy/game.swf"</p>')).toBe(
      'https://www.gamebox.tw/swf/legacy/game.swf'
    );
  });

  it('页面没有 SWF 时返回 null', () => {
    expect(extractGameboxSwfUrl('<html>只有缩略图 a.jpg</html>')).toBeNull();
  });
});

describe('extractGameboxTitle', () => {
  it('取页面标题里的游戏名（去掉站名后缀）', () => {
    expect(extractGameboxTitle(gamePage('/swf/a.swf'))).toBe('細菌大戰');
    expect(extractGameboxTitle('<title>妙手小神医 | GameBox</title>')).toBe('妙手小神医');
    expect(extractGameboxTitle('<title>勇者之路</title>')).toBe('勇者之路');
  });

  it('没有标题标签时退回游戏名 h1，跳过站名 h1', () => {
    expect(
      extractGameboxTitle(
        '<h1 class="a">GameBox</h1><h1 class="b">死亡之路中文版</h1>'
      )
    ).toBe('死亡之路中文版');
  });

  it('标题只剩站名或全无标题时返回 null（由调用方兜底命名）', () => {
    expect(extractGameboxTitle('<title>GameBox</title><h1>GameBox</h1>')).toBeNull();
    expect(extractGameboxTitle('<html><body>x</body></html>')).toBeNull();
  });
});
