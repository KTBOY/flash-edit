import type { DownloadPhase, DownloadSource } from '@shared/types';

/**
 * provider 契约：每个支持的网络下载来源实现一份，交给 DownloadManager 统一调度。
 * provider 只负责「把这个站点的输入解析成游戏页、再把游戏页变成 SWF 字节」，
 * 队列、并发、进度节流、落盘命名与游戏库登记都由管理器统一处理。
 */

/** provider 主动中断取源时抛这个错，管理器据此把任务收尾为「已取消」而非失败 */
export class DownloadCancelledError extends Error {
  constructor() {
    super('下载已取消');
    this.name = 'DownloadCancelledError';
  }
}

/** 解析后的下载目标 */
export interface DownloadTarget {
  gameId: string;
  pageUrl: string;
}

/**
 * provider 取源时可用的运行期能力。
 * progress / cancelled / signal 让站点自带的兜底链路（浏览器分片捕获等）
 * 能照常上报进度并响应取消。
 */
export interface SwfFetchContext {
  readonly source: DownloadSource;
  readonly target: DownloadTarget;
  readonly signal: AbortSignal;
  /** 用户已请求取消（provider 在长循环里自查，尽快收尾） */
  cancelled(): boolean;
  /** 注册站点侧的中断动作（如关闭无头浏览器），取消时与 signal 一起触发 */
  addAbortAction(action: () => Promise<void>): void;
  progress(
    phase: DownloadPhase,
    bytes?: { receivedBytes?: number; totalBytes?: number; chunkCount?: number }
  ): void;
}

/** provider 取源结果：完整 SWF 字节 + 用于文件名的游戏标题 */
export interface SwfFetchResult {
  bytes: Uint8Array;
  title: string;
}

export interface SwfSourceProvider {
  readonly source: DownloadSource;
  /** 归一化用户输入（游戏页 URL 或纯数字 ID）；不属于本站点格式时返回 null */
  parse(input: string): DownloadTarget | null;
  /** 输入格式说明，用于拒绝非法输入时回给用户看 */
  readonly inputHint: string;
  /** 取回游戏本体；失败直接抛错，由管理器写入任务失败原因 */
  fetch(ctx: SwfFetchContext): Promise<SwfFetchResult>;
}
