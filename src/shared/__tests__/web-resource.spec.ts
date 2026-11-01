import { describe, expect, it } from 'vitest';
import {
  extractPageTitle,
  extractWebResources,
  fileNameFromUrl,
  filterGameshareResources,
  isGameshareUrl,
  normalizeResourceUrl,
  sanitizeFileName
} from '@shared/web-resource';

const PAGE = 'https://www.gameshare.cc/posts/2115635614141870089';

describe('isGameshareUrl', () => {
  it('命中主域与子域', () => {
    expect(isGameshareUrl(PAGE)).toBe(true);
    expect(isGameshareUrl('https://gameshare.cc/posts/1')).toBe(true);
    expect(isGameshareUrl('https://cdn.gameshare.cc/a.jpg')).toBe(true);
  });

  it('其他域名与非 http 地址不误判', () => {
    expect(isGameshareUrl('https://gamebox.tw/game/8067')).toBe(false);
    expect(isGameshareUrl('https://notgameshare.cc/a')).toBe(false);
    expect(isGameshareUrl('not a url')).toBe(false);
  });
});

describe('fileNameFromUrl', () => {
  it('取最后一段路径并解码', () => {
    expect(fileNameFromUrl('https://cdn.example.com/a/b/ss_1.1920x1080.jpg?t=1')).toBe(
      'ss_1.1920x1080.jpg'
    );
    expect(fileNameFromUrl('https://cdn.example.com/%E5%A4%A9%E9%81%93.jpg')).toBe('天道.jpg');
  });

  it('无文件名时返回空串', () => {
    expect(fileNameFromUrl('https://cdn.example.com/')).toBe('');
    expect(fileNameFromUrl('not a url')).toBe('');
  });
});

describe('sanitizeFileName', () => {
  it('替换 Windows 非法字符并去掉结尾点/空格', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j. ')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('空名回退默认值；纯非法字符只被替换不清空', () => {
    expect(sanitizeFileName('   ')).toBe('resource');
    expect(sanitizeFileName('???', 'fallback')).toBe('___');
  });

  it('避开 Windows 保留设备名', () => {
    expect(sanitizeFileName('con')).toBe('_con');
    expect(sanitizeFileName('NUL.txt')).toBe('_NUL.txt');
  });

  it('超长时截断但保留扩展名', () => {
    const long = `${'名'.repeat(130)}.jpg`;
    const cleaned = sanitizeFileName(long);
    expect(cleaned.length).toBeLessThanOrEqual(120);
    expect(cleaned.endsWith('.jpg')).toBe(true);
  });
});

describe('normalizeResourceUrl', () => {
  it('相对路径按页面地址补全，HTML 实体还原', () => {
    expect(normalizeResourceUrl('/images/a.jpg?t=1&amp;x=2', PAGE)).toBe(
      'https://www.gameshare.cc/images/a.jpg?t=1&x=2'
    );
    expect(normalizeResourceUrl('ss_1.1920x1080.jpg', 'https://cdn.example.com/a/')).toBe(
      'https://cdn.example.com/a/ss_1.1920x1080.jpg'
    );
  });

  it('data: 与非法地址被丢弃', () => {
    expect(normalizeResourceUrl('data:image/png;base64,AAAA', PAGE)).toBeNull();
    expect(normalizeResourceUrl('javascript:void(0)', PAGE)).toBeNull();
    expect(normalizeResourceUrl('', PAGE)).toBeNull();
  });
});

describe('extractWebResources', () => {
  it('img 标签：src / data-src 懒加载 / srcset 第一个候选，相对地址补全', () => {
    const html = [
      '<img src="https://cdn.queniuqe.com/a/header.jpg?t=1">',
      '<img data-src="/images/lazy/ss_2.jpg">',
      '<img srcset="/images/ss_3.1920x1080.jpg 1920w, /images/ss_3.960w.jpg 960w" src="/placeholder.png">'
    ].join('');
    const urls = extractWebResources(html, PAGE).map((r) => r.url);
    expect(urls).toContain('https://cdn.queniuqe.com/a/header.jpg?t=1');
    expect(urls).toContain('https://www.gameshare.cc/images/lazy/ss_2.jpg');
    expect(urls).toContain('https://www.gameshare.cc/images/ss_3.1920x1080.jpg');
  });

  it('video / source 标签识别为视频，地址补全并命名', () => {
    const html = '<video poster="/p.jpg"><source src="/media/clip.mp4" type="video/mp4"></video>';
    const list = extractWebResources(html, PAGE);
    const video = list.find((r) => r.kind === 'video');
    expect(video?.url).toBe('https://www.gameshare.cc/media/clip.mp4');
    expect(video?.fileName).toBe('clip.mp4');
  });

  it('RSC payload 里转义的视频直链也能提取', () => {
    const html = `<script>self.__next_f.push([1,"https:\\/\\/cdn.example.com\\/media\\/game.mp4?sign=1\\u0026t=2"])</script>`;
    const video = extractWebResources(html, PAGE).find((r) => r.kind === 'video');
    expect(video?.url).toBe('https://cdn.example.com/media/game.mp4?sign=1&t=2');
  });

  it('HLS 播放列表（m3u8）归入嵌入而非视频，JSON 转义残留不混入地址', () => {
    const html = [
      '<video src="https://cdn.example.com/hls_master.m3u8?t=1"></video>',
      '<script>self.__next_f.push([1,"https:\\/\\/cdn.example.com\\/trailers\\/hls_264_master.m3u8?t=2\\"])</script>'
    ].join('');
    const embeds = extractWebResources(html, PAGE).filter((r) => r.kind === 'embed');
    expect(embeds.map((r) => r.url)).toEqual([
      'https://cdn.example.com/hls_master.m3u8?t=1',
      'https://cdn.example.com/trailers/hls_264_master.m3u8?t=2'
    ]);
    expect(embeds.map((r) => r.fileName)).toEqual(['hls_master.m3u8', 'hls_264_master.m3u8']);
  });

  it('已知视频平台 iframe 记为 embed，其他 iframe 不收', () => {
    const html =
      '<iframe src="https://v.qq.com/txp/iframe/player.html?vid=abc"></iframe>' +
      '<iframe src="https://player.bilibili.com/player.html?bvid=BV1x"></iframe>' +
      '<iframe src="https://ads.example.com/banner"></iframe>';
    const embeds = extractWebResources(html, PAGE).filter((r) => r.kind === 'embed');
    expect(embeds.map((r) => r.url)).toEqual([
      'https://v.qq.com/txp/iframe/player.html?vid=abc',
      'https://player.bilibili.com/player.html?bvid=BV1x'
    ]);
    expect(embeds[0].fileName).toMatch(/\.html$/);
  });

  it('去重、剔除 favicon 与 svg 装饰图，按 图片→视频→嵌入 排序', () => {
    const html = [
      '<iframe src="https://v.qq.com/txp/iframe/player.html?vid=abc"></iframe>',
      '<img src="/a.jpg">',
      '<link rel="icon" href="/favicon.ico">',
      '<img src="/b.jpg">',
      '<img src="https://www.gameshare.cc/a.jpg">',
      '<img src="/icon.svg">',
      '<video src="/v.mp4">'
    ].join('');
    const list = extractWebResources(html, PAGE);
    expect(list.map((r) => r.kind)).toEqual(['image', 'image', 'video', 'embed']);
  });

  it('路径段无扩展名的资源按类型补扩展名', () => {
    const image = extractWebResources('<img src="https://cdn.example.com/download?id=1">', PAGE)[0];
    expect(image.fileName).toBe('download.jpg');
  });

  it('完全没有路径段的资源生成回退名', () => {
    const image = extractWebResources('<img src="https://cdn.example.com/?id=1">', PAGE)[0];
    expect(image.fileName).toMatch(/^resource_1\.jpg$/);
  });
});

describe('filterGameshareResources', () => {
  it('剔除站内 UI 图标，保留外链 CDN 资源', () => {
    const list = extractWebResources(
      [
        '<img src="/images/pan/kkp.webp">',
        '<img src="/images/pan/bd.webp">',
        '<img src="https://www.gameshare.cc/favicon.svg">',
        '<img src="https://shared.cdn.queniuqe.com/store/ss_1.1920x1080.jpg?t=1">'
      ].join(''),
      PAGE
    );
    const filtered = filterGameshareResources(list);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].url).toBe(
      'https://shared.cdn.queniuqe.com/store/ss_1.1920x1080.jpg?t=1'
    );
  });
});

describe('extractPageTitle', () => {
  it('取标题并还原实体', () => {
    expect(
      extractPageTitle('<title>天道绘卷 &mdash; &amp; 序章 | Game Share</title>')
    ).toBe('天道绘卷 &mdash; & 序章 | Game Share');
    expect(extractPageTitle('<html><body>no title</body></html>')).toBe('');
  });
});
