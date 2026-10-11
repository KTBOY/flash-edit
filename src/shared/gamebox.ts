/**
 * gamebox.tw 游戏输入解析与页面取源（纯逻辑，主进程 provider 与测试共用）。
 * 接受游戏页 URL（https://www.gamebox.tw/game/<ID>）或纯数字游戏 ID。
 */

export interface ParsedGameboxInput {
  /** 纯数字游戏 ID，如 "8067" */
  gameId: string
  /** 游戏页地址（已归一化到 www 域） */
  pageUrl: string
}

/** 站点的对象存储前缀：页面里的 SWF 路径都是相对它拼出来的 */
const STORAGE_PREFIX = 'https://nbg1.your-objectstorage.com/gamebox';
const GAME_PAGE_RE = /^https?:\/\/(www\.)?gamebox\.tw\/game\/\d+/;

/** 解析用户输入；非法输入返回 null。容忍链接带查询串/锚点（分享链接常见） */
export function parseGameboxInput(raw: string): ParsedGameboxInput | null {
  const input = raw.trim();
  if (/^\d+$/.test(input)) {
    return { gameId: input, pageUrl: `https://www.gamebox.tw/game/${input}` };
  }
  if (!GAME_PAGE_RE.test(input)) return null;
  try {
    const gameId = new URL(input).pathname.match(/\/game\/(\d+)/)?.[1];
    if (!gameId) return null;
    return { gameId, pageUrl: `https://www.gamebox.tw/game/${gameId}` };
  } catch {
    return null;
  }
}

/**
 * 从游戏页 HTML 取出游戏本体的完整地址。
 *
 * 页面自己也是这么拼的：`getGameSwfUrl()` 返回 `ensureStorageUrl("/swf/celue/<ts>.swf")`，
 * 而 `ensureStorageUrl` 把根相对路径接到对象存储前缀后面（前缀写在页面脚本里，故优先读它）。
 * 路径中的目录名没有规律（见过 celue/、日期目录），文件名是上传时间戳，都不能按 ID 拼。
 * 解析顺序与站点脚本保持一致：加载器实参 → 绝对地址 → 根相对路径接回页面域名。
 */
export function extractGameboxSwfUrl(html: string): string | null {
  const storageArg = html.match(
    /ensureStorageUrl\(\s*(['"])([^'"]+?\.swf(?:[?#][^'"]*)?)\1\s*\)/
  )?.[2];
  if (!storageArg) {
    const absolute = html.match(/(https?:\/\/[^"'\\\s]+?\.swf)/i)?.[1];
    if (absolute) return absolute;
    const relative = html.match(/(['"])(\/[^'"]+?\.swf)\1/)?.[2];
    return relative ? new URL(relative, 'https://www.gamebox.tw').href : null;
  }
  try {
    new URL(storageArg);
    return storageArg;
  } catch {
    const prefix = html.match(/prefix\s*=\s*(['"])(https?:\/\/[^'"]+?)\1/)?.[2] ?? STORAGE_PREFIX;
    return storageArg.startsWith('/') ? prefix + storageArg : `${prefix}/${storageArg}`;
  }
}

/**
 * 从游戏页 HTML 取游戏名。
 * 页面标题形如 `細菌大戰 - GameBox`；`<h1>` 里站名与游戏名各一个，因此先去后缀、
 * 再退回到不是站名的 h1，两条路都拿不到时返回 null 由调用方兜底。
 */
export function extractGameboxTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const stripped = title?.replace(/\s*[-–—|｜]\s*gamebox\s*$/i, '').trim();
  if (stripped && !/^gamebox$/i.test(stripped)) return stripped;
  for (const matched of html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)) {
    const text = matched[1]?.trim();
    if (text && !/^gamebox$/i.test(text)) return text;
  }
  return null;
}
