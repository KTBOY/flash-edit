/**
 * oldswf.com 游戏输入解析（纯逻辑，主进程下载服务与渲染层入口引导共用）。
 * 接受游戏页 URL（oldswf.com / oldswf.top）或纯数字游戏 ID。
 */

export interface ParsedOldswfInput {
  /** 纯数字游戏 ID，如 "109087" */
  gameId: string;
  /** 游戏页地址 */
  pageUrl: string;
}

const GAME_PAGE_RE = /^https?:\/\/oldswf\.(com|top)\/game\/\d+/;

/** 解析用户输入；非法输入返回 null。容忍链接带查询串/锚点（分享链接常见） */
export function parseOldswfInput(raw: string): ParsedOldswfInput | null {
  const input = raw.trim();
  if (/^\d+$/.test(input)) {
    return { gameId: input, pageUrl: `https://oldswf.com/game/${input}` };
  }
  if (!GAME_PAGE_RE.test(input)) return null;
  try {
    const url = new URL(input);
    const gameId = url.pathname.match(/\/game\/(\d+)$/)?.[1];
    if (!gameId) return null;
    return { gameId, pageUrl: `${url.origin}/game/${gameId}` };
  } catch {
    return null;
  }
}

/** 用户输入是否指向 oldswf 游戏页（用于「网络加载」入口的引导分流） */
export function isOldswfGamePageUrl(raw: string): boolean {
  return GAME_PAGE_RE.test(raw.trim());
}

/**
 * 从游戏页 HTML 取出真实 SWF 路径（形如 `/data/extra/mxwsbcqwdb/game.swf`）。
 *
 * oldswf 的资源路径没有固定规律：目录见过 `/data/extra/<slug>/`、`/data/game/`、
 * `/data/game_2024/`、`/data/swf/`，文件名也不等于游戏 ID（页面 100 → 13278.swf）。
 * 唯一可靠来源是页面交给播放器的 `loadSwf("...")` 实参，因此只能从 HTML 里读，不能按 ID 拼。
 * 取不到返回 null，调用方需回退到浏览器捕获。
 */
export function extractSwfPath(html: string): string | null {
  const matched = html.match(/\bloadSwf\(\s*(['"])([^'"]+?\.swf(?:[?#][^'"]*)?)\1\s*\)/);
  const raw = matched?.[2]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, 'https://oldswf.com');
    return url.pathname.endsWith('.swf') ? url.pathname : null;
  } catch {
    return null;
  }
}

/** 从游戏页 HTML 的 h3 取游戏名（与页面标题元素一致），取不到返回 null */
export function extractGameTitle(html: string): string | null {
  const matched = html.match(/<h3[^>]*>\s*([^<]+?)\s*<\/h3>/i);
  return matched?.[1]?.trim() || null;
}

/**
 * 解析资源清单 `files.xml`（形如 `<files><item>game.swf</item></files>`）。
 *
 * 有些页面的 loadSwf 指向预加载壳（实测 224992 → 10 KB 的 gameload.swf，
 * 内含 4399load_fla / game_loader 符号），壳运行时读同目录 files.xml 才拿到真正本体，
 * 只存壳文件对用户不可用，因此要按清单再取一层。条目路径由调用方相对清单所在目录解析。
 */
export function parseFilesXml(xml: string): string[] {
  const items: string[] = [];
  for (const matched of xml.matchAll(/<item>([^<]+)<\/item>/gi)) {
    const raw = matched[1]?.trim();
    if (!raw || !raw.toLowerCase().endsWith('.swf')) continue;
    if (!items.includes(raw)) items.push(raw);
  }
  return items;
}

/** 文件名清洗：非法字符替换为下划线并限长 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);
}
