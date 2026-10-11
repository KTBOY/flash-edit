import type { SwfFetchContext, SwfFetchResult, SwfSourceProvider } from '../download/provider';
import { DownloadCancelledError } from '../download/provider';
import { extractGameboxSwfUrl, extractGameboxTitle, parseGameboxInput } from '@shared/gamebox';
import { logger } from '../../infra/logger';

/**
 * gamebox.tw 取源 provider。
 *
 * 与 oldswf 相反，这个站不难抓：游戏页 HTML 用 Node 直连就能拿到 200，
 * 页面里只有一处游戏本体地址（对象存储直链，路径含上传时间戳，无法按 ID 拼）。
 * 唯一门槛是防盗链：存储桶只认 Referer 属于 https://www.gamebox.tw/ 的请求，
 * 缺它（含 HEAD、含 Range 无 Referer）一律 403 + 一小段 XML 错误页，
 * 因此下载必须带上游戏页地址作 Referer。支持 Range，但单连接全量拉已足够快。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;
/** 进度节流间隔（管理器另有推送节流，这里控制取数循环的调用频率） */
const PROGRESS_INTERVAL_MS = 200;

/** 带超时与外部中断的 fetch：超时/取消都表现为 AbortError，由调用方区分 */
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  outer: AbortSignal,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const relay = () => controller.abort();
  outer.addEventListener('abort', relay);
  try {
    return await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', relay);
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

async function fetchSwf(ctx: SwfFetchContext, swfUrl: string): Promise<Uint8Array> {
  const resp = await fetchWithTimeout(
    swfUrl,
    { 'User-Agent': USER_AGENT, Referer: ctx.target.pageUrl },
    ctx.signal,
    DOWNLOAD_TIMEOUT_MS
  );
  if (!resp.ok || !resp.body) {
    throw new Error(
      `游戏资源读取失败（HTTP ${resp.status}）。带 Referer 仍被拒时通常是站点调整了防盗链或游戏已下架`
    );
  }
  const total = Number(resp.headers.get('content-length')) || 0;
  const parts: Uint8Array[] = [];
  let received = 0;
  let lastEmit = 0;
  for await (const part of resp.body as AsyncIterable<Uint8Array>) {
    if (ctx.cancelled()) throw new DownloadCancelledError();
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
  if (!bytes) throw new Error('游戏资源为空');
  return bytes;
}

export const gameboxProvider: SwfSourceProvider = {
  source: 'gamebox',
  inputHint: '应为 https://www.gamebox.tw/game/<数字ID> 或纯数字游戏 ID',

  parse(raw) {
    return parseGameboxInput(raw);
  },

  async fetch(ctx): Promise<SwfFetchResult> {
    const { gameId, pageUrl } = ctx.target;
    ctx.progress('starting');

    const page = await fetchWithTimeout(
      pageUrl,
      { 'User-Agent': USER_AGENT },
      ctx.signal,
      PAGE_TIMEOUT_MS
    );
    if (!page.ok) {
      throw new Error(`游戏页读取失败（HTTP ${page.status}），请确认地址 ${pageUrl} 仍然有效`);
    }
    const html = await page.text();
    const swfUrl = extractGameboxSwfUrl(html);
    if (!swfUrl) {
      throw new Error('未在页面中解析到 SWF 地址，站点可能改了页面结构');
    }
    logger.info('download', `gamebox 游戏 ${gameId} 资源地址：${swfUrl}`);

    const bytes = await fetchSwf(ctx, swfUrl);
    return { bytes, title: extractGameboxTitle(html) || `gamebox_${gameId}` };
  }
};
