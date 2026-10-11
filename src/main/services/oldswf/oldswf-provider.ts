import { chromium, type Browser, type Page } from 'playwright-core';
import type { SwfFetchContext, SwfFetchResult, SwfSourceProvider } from '../download/provider';
import { DownloadCancelledError } from '../download/provider';
import {
  extractGameTitle,
  extractSwfPath,
  parseFilesXml,
  parseOldswfInput
} from '@shared/oldswf';
import { logger } from '../../infra/logger';
import { isSwfMagic, parseContentRange, SwfChunkAssembler } from './chunk-assembler';

/**
 * oldswf.com 取源 provider。
 *
 * 站点的防护只针对 HTML 类响应：游戏页与 `.xml` 清单实测无论带不带浏览器 UA
 * 都是 Node fetch → 403（拿到的是 Cloudflare 挑战页；curl / 真实浏览器的 TLS 指纹能过），
 * 而 `.swf` 资源完全不校验客户端——直接 200 全量，且支持 206 Range。
 *
 * 因此分工是：用 playwright-core 驱动系统已安装的 Edge/Chrome 打开游戏页，只为读出
 * 页面交给播放器的真实 SWF 路径（见 extractSwfPath：目录与文件名都不按游戏 ID 走规律），
 * 随后用 Node 直连把整份 SWF 拉下来，比等站点自己的多线程下载快一个量级。
 * 少数页面的 loadSwf 指向的是预加载壳，还要按同目录 files.xml 再取一层本体（见 resolveShell）。
 *
 * 兜底：直连不通（站点把资源也纳入校验，或路径没解析出来）时，退回去旁观站点的分片
 * 下载并按 Content-Range 偏移重组；仍不完整则从页面写入的 IndexedDB 缓存提取。
 *
 * 队列与落盘在 DownloadManager；这里每个任务只占用自己的浏览器会话。
 */

const DOWNLOAD_TIMEOUT_MS = 300_000;
/** 直连下载超时不判失败，回退到浏览器侧捕获 */
const DIRECT_TIMEOUT_MS = 240_000;
/** 低于此体积视为疑似加载壳，需按 files.xml 再取一层本体 */
const PRELOADER_MAX_BYTES = 512 * 1024;
const PAGE_GOTO_TIMEOUT_MS = 60_000;
const TITLE_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 500;
/** 进度推送节流间隔，避免按数据块把 IPC 打满 */
const PROGRESS_INTERVAL_MS = 200;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BROWSER_ARGS = ['--disable-blink-features=AutomationControlled'];

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
}

/** 启动系统真实浏览器（优先 Edge，其次 Chrome，最后回退 playwright 自带内核） */
async function launchRealBrowser(): Promise<Browser> {
  const failures: string[] = [];
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ headless: true, channel, args: BROWSER_ARGS });
    } catch (error) {
      failures.push(`${channel}：${firstLine(error)}`);
    }
  }
  try {
    return await chromium.launch({ headless: true, args: BROWSER_ARGS });
  } catch (error) {
    failures.push(`chromium：${firstLine(error)}`);
    throw new Error(
      `未找到可用的浏览器（需要系统安装 Microsoft Edge 或 Chrome）。尝试记录：${failures.join('；')}`
    );
  }
}

/** 把流式收集到的数据块按序拼接为完整字节；空结果返回 null */
function concat(parts: Uint8Array[], total: number): Uint8Array | null {
  if (total <= 0) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * 从页面 IndexedDB（swfFiles → blobs）提取 SWF 的浏览器端脚本。
 * 站点以交给播放器的路径为键（keyPath "id"）整份存成 {id, blob, timestamp}，
 * 同库里还有字体 swf（/css/font*.swf），因此优先精确命中已知路径，
 * 否则在所有 .swf 记录里挑最大的一份，避免把字体当游戏。
 * blob → base64 分块转换，避免大文件按字节数组走序列化的开销。
 * 以字符串形式交给 page.evaluate：主进程 tsconfig 无 DOM lib，内联脚本不参与类型检查。
 */
function indexedDbExtractExpression(swfPath: string | null): string {
  return [
    '(async () => {',
    '  const KEY = ' + JSON.stringify(swfPath) + ';',
    '  const open = () => new Promise((res, rej) => {',
    '    const r = indexedDB.open("swfFiles");',
    '    r.onsuccess = () => res(r.result);',
    '    r.onerror = () => rej(r.error);',
    '  });',
    '  const all = (db) => new Promise((res, rej) => {',
    '    const t = db.transaction("blobs", "readonly");',
    '    const req = t.objectStore("blobs").getAll();',
    '    req.onsuccess = () => res(req.result || []);',
    '    req.onerror = () => rej(req.error);',
    '  });',
    '  const toBase64 = async (blob) => {',
    '    const bytes = new Uint8Array(await blob.arrayBuffer());',
    '    let binary = "";',
    '    for (let i = 0; i < bytes.length; i += 0x8000) {',
    '      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));',
    '    }',
    '    return btoa(binary);',
    '  };',
    '  try {',
    '    const records = await all(await open());',
    '    const blobs = records',
    '      .filter((r) => r && r.id && typeof r.id === "string" && r.id.endsWith(".swf"))',
    '      .filter((r) => r.id.indexOf("/css/") !== 0)',
    '      .map((r) => ({ id: r.id, blob: r.data || r.blob }))',
    '      .filter((r) => r.blob && typeof r.blob.size === "number");',
    '    if (!blobs.length) return null;',
    '    const hit = KEY ? blobs.find((r) => r.id === KEY) : null;',
    '    const best = hit || blobs.reduce((a, b) => (b.blob.size > a.blob.size ? b : a));',
    '    return await toBase64(best.blob);',
    '  } catch {',
    '    return null;',
    '  }',
    '})()'
  ].join('\n');
}

/** 从游戏页 h3 标题取游戏名，取不到用默认名 */
async function readGameTitle(page: Page, gameId: string): Promise<string> {
  const fallback = `oldswf_${gameId}`;
  try {
    const text = await page.locator('h3').first().textContent({ timeout: TITLE_TIMEOUT_MS });
    return text?.trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * 直连下载 SWF。返回 null 表示「这条路走不通」（应回退浏览器捕获），
 * 而不是「下载失败」——内容非 SWF、超时、状态码异常都归此类。
 */
async function downloadDirect(
  ctx: SwfFetchContext,
  swfUrl: string,
  signal: AbortSignal
): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  const relayAbort = (): void => controller.abort();
  signal.addEventListener('abort', relayAbort);
  const parts: Uint8Array[] = [];
  let received = 0;
  let lastEmit = 0;
  try {
    const resp = await fetch(swfUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!resp.ok || !resp.body) return null;
    const total = Number(resp.headers.get('content-length')) || 0;
    for await (const part of resp.body as AsyncIterable<Uint8Array>) {
      const chunk = part instanceof Uint8Array ? part : new Uint8Array(part as ArrayBuffer);
      parts.push(chunk);
      received += chunk.length;
      const now = Date.now();
      if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now;
        ctx.progress('downloading', { receivedBytes: received, totalBytes: total });
      }
    }
    const bytes = concat(parts, received);
    return bytes && isSwfMagic(bytes) ? bytes : null;
  } catch (error) {
    if (ctx.cancelled()) throw new DownloadCancelledError();
    logger.warn('download', `oldswf 直连下载未完成：${firstLine(error)}`);
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', relayAbort);
  }
}

/**
 * 预加载壳解析：loadSwf 有时指向几十 KB 的加载器（实测 224992 → gameload.swf 10 KB，
 * 内含 4399load_fla / game_loader 符号），它运行时读同目录 files.xml 才拿到真正本体。
 * 只存壳会让用户拿到一个不可用的文件，所以对疑似壳按清单再取一层；
 * 仅当清单里的 SWF 更大时才替换——多数游戏没有 files.xml，或清单只是噪声时保持原样。
 *
 * 清单必须在页面上下文里读：`.xml` 与游戏页 HTML 同样受 TLS 指纹校验，
 * Node 直取只会拿到 Cloudflare 的 403 挑战页；而 `.swf` 资源不校验客户端，仍可直连。
 */
async function resolveShell(
  ctx: SwfFetchContext,
  page: Page,
  bytes: Uint8Array,
  swfUrl: string | null,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (!swfUrl || bytes.length > PRELOADER_MAX_BYTES) return bytes;

  const listUrl = new URL('files.xml', swfUrl).href;
  const items = parseFilesXml(
    (await page.evaluate<string | null>(
      [
        '(async () => {',
        '  try {',
        '    const r = await fetch(' + JSON.stringify(listUrl) + ', { credentials: "include" });',
        '    return r.ok ? await r.text() : null;',
        '  } catch {',
        '    return null;',
        '  }',
        '})()'
      ].join('\n')
    )) ?? ''
  );

  let best: Uint8Array | null = null;
  for (const item of items) {
    const next = await downloadDirect(ctx, new URL(item, swfUrl).href, signal);
    if (next && next.length > bytes.length && (!best || next.length > best.length)) best = next;
  }
  if (!best) {
    logger.warn(
      'download',
      `oldswf 游戏 ${ctx.target.gameId} 资源仅 ${bytes.length} 字节且清单未给出更大本体，按原样保存`
    );
    return bytes;
  }
  logger.info(
    'download',
    `oldswf 游戏 ${ctx.target.gameId} 命中的是加载壳，已按 files.xml 取到本体 ${(
      best.length /
      1024 /
      1024
    ).toFixed(2)} MB（清单共 ${items.length} 项）`
  );
  return best;
}

/** 打开游戏页、解析资源地址，直连优先、浏览器捕获与页面缓存兜底 */
async function capture(ctx: SwfFetchContext, browser: Browser): Promise<SwfFetchResult> {
  const { gameId, pageUrl } = ctx.target;

  ctx.progress('starting');
  const page = await browser.newPage({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 800 }
  });
  const assembler = new SwfChunkAssembler();
  /** 页面交给播放器的真实资源路径；未解析出来前为 null */
  let swfPath: string | null = null;

  // 站点还会拉 /css/font*.swf 字体，必须排除；已知游戏路径时只认这一条
  const isGameSwf = (url: string): boolean => {
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return false;
    }
    if (!path.endsWith('.swf') || path.startsWith('/css/')) return false;
    return swfPath ? path === swfPath : true;
  };

  // 监听必须在 goto 之前挂上，否则会漏掉首批发出的分片
  page.on('response', (resp) => {
    void (async () => {
      try {
        const url = resp.url();
        if (!isGameSwf(url)) return;
        const status = resp.status();
        if (status !== 200 && status !== 206) return;
        const body = await resp.body();
        const contentRange = resp.headers()['content-range'];
        if (status === 200 || !contentRange) {
          assembler.setFullBody(body);
        } else {
          const range = parseContentRange(contentRange);
          if (range) assembler.addChunk(range.start, body, range.total);
        }
      } catch {
        /* 响应体读取竞态（跳转/中断）时忽略该分片，由 IndexedDB 兜底补齐 */
      }
    })();
  });

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_GOTO_TIMEOUT_MS });
  const html = await page.content();
  swfPath = extractSwfPath(html);
  const title = extractGameTitle(html) || (await readGameTitle(page, gameId));
  if (!swfPath) {
    logger.warn('download', `oldswf 游戏 ${gameId} 页面中未解析到 SWF 路径，仅依赖浏览器捕获`);
  }

  /*
   * 主路径：资源本身不校验客户端指纹，所以拿到路径就用 Node 直接拉整份，
   * 比等站点自己的多线程下载快一个量级。期间页面的响应监听照常在为兜底收分片。
   */
  const swfUrl = swfPath ? new URL(swfPath, pageUrl).href : null;
  if (swfUrl) {
    if (ctx.cancelled()) throw new DownloadCancelledError();
    const direct = await downloadDirect(ctx, swfUrl, ctx.signal);
    if (direct) {
      return { bytes: await resolveShell(ctx, page, direct, swfUrl, ctx.signal), title };
    }
    logger.warn('download', `oldswf 游戏 ${gameId} 直连未取到完整资源，改等浏览器侧捕获`);
  }

  // 兜底一：等待分片集齐（网站自身在页面里跑多线程 Range 下载）
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  let assembled: Uint8Array | null = null;
  while (Date.now() < deadline) {
    if (ctx.cancelled()) throw new DownloadCancelledError();
    assembled = assembler.assemble();
    if (assembled) break;
    ctx.progress('downloading', {
      receivedBytes: assembler.receivedBytes,
      totalBytes: assembler.totalSize,
      chunkCount: assembler.chunkCount
    });
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  // 兜底二：网站下载完成后会把 SWF 存进 IndexedDB，直接从缓存提取
  if (!assembled) {
    if (ctx.cancelled()) throw new DownloadCancelledError();
    logger.warn(
      'download',
      `oldswf 游戏 ${gameId} 分片监听未集齐，改从页面 IndexedDB 缓存提取`
    );
    ctx.progress('extracting');
    const base64 = await page.evaluate<string | null>(indexedDbExtractExpression(swfPath));
    if (base64) {
      const buffer = Buffer.from(base64, 'base64');
      assembled = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
  }

  if (ctx.cancelled()) throw new DownloadCancelledError();
  if (!assembled) {
    throw new Error(
      `下载超时（${DOWNLOAD_TIMEOUT_MS / 1000} 秒内未捕获到完整游戏资源），游戏较大或网络较慢时请重试`
    );
  }
  return { bytes: await resolveShell(ctx, page, assembled, swfUrl, ctx.signal), title };
}

export const oldswfProvider: SwfSourceProvider = {
  source: 'oldswf',
  inputHint: '应为 https://oldswf.com/game/<数字ID> 或纯数字游戏 ID',

  parse(raw) {
    return parseOldswfInput(raw);
  },

  async fetch(ctx) {
    const browser = await launchRealBrowser();
    // 关闭浏览器会中断该页面上的所有挂起操作，下载链路随即以取消错误收尾
    ctx.addAbortAction(async () => {
      await browser.close().catch(() => undefined);
    });
    try {
      return await capture(ctx, browser);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
};
