import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DownloadPhase,
  DownloadResult,
  DownloadSource,
  DownloadTask,
  DownloadTaskStatus
} from '@shared/types';
import { downloadTaskId, sanitizeFileName } from '@shared/download';
import { logger } from '../../infra/logger';
import { isLikelySwf } from '../exe-pack.service';
import { DownloadCancelledError, type SwfFetchContext, type SwfSourceProvider } from './provider';

/**
 * 网络下载队列（主进程，多站点共用）。
 *
 * 站点差异都收在 provider 里（输入格式、取源方式、反爬手段），这里只管与站点无关的部分：
 * 并发额度与排队、取消/重试、进度节流推送、SWF 完整性校验、按「标题_游戏 ID」落盘、
 * 落盘成功后登记游戏库。任务表是本进程唯一事实来源，状态与进度都推送给渲染层，
 * 因此面板切走再回来仍能对上进度。
 *
 * 任务标识为 `来源:游戏 ID`：不同站点的游戏 ID 会重号，不能只用 ID 索引。
 */

/** 同时进行的下载任务上限 */
const MAX_CONCURRENT = 3;
/** 进度推送节流间隔，避免按数据块把 IPC 打满 */
const PROGRESS_INTERVAL_MS = 200;

/** 运行期上下文：取消标记与站点侧中断动作按任务隔离 */
interface TaskContext {
  readonly task: DownloadTask;
  cancelRequested: boolean;
  /** provider 注册的中断动作（关闭无头浏览器等） */
  abortActions: (() => Promise<void>)[];
  /** 上次推送进度的时间戳，用于节流 */
  lastPublish: number;
  /** 已从任务表移除：不再对外推送事件，避免迟到的进度把该行"复活" */
  removed: boolean;
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
}

function isTerminal(status: DownloadTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

export class DownloadManager {
  private readonly tasks = new Map<string, TaskContext>();
  private readonly queue: string[] = [];
  private readonly providers = new Map<DownloadSource, SwfSourceProvider>();
  private runningCount = 0;

  constructor(
    /** 支持的站点 provider（注册表；同一来源重复注册以先注册者为准） */
    providers: SwfSourceProvider[],
    /** 下载保存目录取值器（用户可在设置中修改，未设置时回退 userData/games） */
    private readonly getGamesDir: () => string,
    /** 任务快照推送（由 IPC 层转发给渲染进程） */
    private readonly emitTask: (task: DownloadTask) => void,
    /**
     * 落盘成功回调：主进程据此直接登记游戏库，
     * 用户不必等游戏被载入，多任务下载时记录也不会丢。
     * hash 为文件内容 sha256，与渲染层载入同一文件时算出的哈希一致。
     */
    private readonly onSaved: (result: DownloadResult, hash: string) => void
  ) {
    for (const provider of providers) {
      if (!this.providers.has(provider.source)) this.providers.set(provider.source, provider);
    }
  }

  /** 全部任务快照（含已结束），按创建时间倒序 */
  list(): DownloadTask[] {
    return [...this.tasks.values()]
      .map((ctx) => ({ ...ctx.task }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 提交下载任务。来源由渲染层的站点入口决定，因此纯数字 ID 不会被两个站点抢。
   * 同一来源同一游戏 ID 仍在排队或下载中时拒绝；已结束的同 ID 任务就地复用槽位重跑（即「重试」）。
   */
  start(source: DownloadSource, input: string): DownloadTask {
    const provider = this.providers.get(source);
    if (!provider) throw new Error(`不支持的下载来源：${String(source)}`);
    const target = provider.parse(input);
    if (!target) throw new Error(`无法识别的游戏地址：${provider.inputHint}`);

    const id = downloadTaskId(source, target.gameId);
    const existing = this.tasks.get(id);
    if (existing && !isTerminal(existing.task.status)) {
      throw new Error(`游戏 ${target.gameId} 已在下载队列中`);
    }

    const task: DownloadTask = {
      id,
      source,
      gameId: target.gameId,
      input: input.trim(),
      status: 'queued',
      phase: null,
      receivedBytes: 0,
      totalBytes: 0,
      chunkCount: 0,
      result: null,
      error: null,
      createdAt: existing?.task.createdAt ?? Date.now()
    };
    const ctx: TaskContext = {
      task,
      cancelRequested: false,
      abortActions: [],
      lastPublish: 0,
      removed: false
    };
    this.tasks.set(id, ctx);
    this.queue.push(id);
    this.publish(ctx, true);
    this.pump();
    return { ...task };
  }

  /** 取消指定任务：排队中直接出队，下载中触发其中断动作 */
  cancel(id: string): boolean {
    const ctx = this.tasks.get(id);
    if (!ctx || isTerminal(ctx.task.status)) return false;

    ctx.cancelRequested = true;
    const queuedAt = this.queue.indexOf(id);
    if (queuedAt >= 0) {
      this.queue.splice(queuedAt, 1);
      this.finish(ctx, 'canceled');
      return true;
    }
    // 中断动作会打断该任务的所有挂起操作（如关掉浏览器即中断其分片监听），下载链路随即以取消错误收尾
    void this.abort(ctx);
    return true;
  }

  /**
   * 从任务表移除指定任务（只影响列表，不动游戏库与磁盘文件）。
   * 仍在排队或下载中的任务先走取消流程，再删除记录。
   */
  remove(ids: string[]): void {
    for (const id of ids) {
      const ctx = this.tasks.get(id);
      if (!ctx) continue;
      ctx.removed = true;
      this.cancel(id);
      this.tasks.delete(id);
    }
  }

  /** 有空闲并发额度就派发排队任务 */
  private pump(): void {
    while (this.runningCount < MAX_CONCURRENT && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) return;
      const ctx = this.tasks.get(id);
      if (!ctx || ctx.task.status !== 'queued') continue;
      this.runningCount += 1;
      void this.run(ctx).finally(() => {
        this.runningCount -= 1;
        this.pump();
      });
    }
  }

  private async run(ctx: TaskContext): Promise<void> {
    ctx.task.status = 'running';
    this.publish(ctx, true);
    const { source, gameId, input } = ctx.task;
    logger.info('download', `开始下载 ${source} 游戏 ${gameId}`);

    const provider = this.providers.get(source);
    if (!provider) {
      this.finish(ctx, 'failed', `不支持的下载来源：${source}`);
      return;
    }
    const target = provider.parse(input);
    if (!target) {
      this.finish(ctx, 'failed', `无法识别的游戏地址：${provider.inputHint}`);
      return;
    }

    // abort 用于中断 Node 侧请求，单靠 provider 注册的动作（关浏览器等）打断不了它
    const controller = new AbortController();
    ctx.abortActions = [async () => controller.abort()];
    const fetchCtx: SwfFetchContext = {
      source,
      target,
      signal: controller.signal,
      cancelled: () => ctx.cancelRequested || controller.signal.aborted,
      addAbortAction: (action) => ctx.abortActions.push(action),
      progress: (phase, bytes) => this.setProgress(ctx, phase, bytes)
    };
    try {
      const { bytes, title } = await provider.fetch(fetchCtx);
      const saved = await this.save(ctx, source, target.gameId, bytes, title);
      this.onSaved(saved.result, saved.hash);
      this.finish(ctx, 'succeeded', null, saved.result);
    } catch (error) {
      if (ctx.cancelRequested || error instanceof DownloadCancelledError) {
        this.finish(ctx, 'canceled');
      } else {
        this.finish(ctx, 'failed', firstLine(error));
      }
    } finally {
      ctx.abortActions = [];
    }
  }

  /** 校验并落盘：文件名沿用「清洗后标题_游戏ID.swf」，不用站点上的资源文件名 */
  private async save(
    ctx: TaskContext,
    source: DownloadSource,
    gameId: string,
    bytes: Uint8Array,
    title: string
  ): Promise<{ result: DownloadResult; hash: string }> {
    if (!isLikelySwf(bytes)) {
      throw new Error('下载内容不是合法 SWF（文件头应为 FWS/CWS/ZWS），可能不完整，请重试');
    }
    this.setProgress(ctx, 'saving', { receivedBytes: bytes.length, totalBytes: bytes.length });
    const fileName = `${sanitizeFileName(title) || `${source}_${gameId}`}_${gameId}.swf`;
    const gamesDir = this.getGamesDir();
    await mkdir(gamesDir, { recursive: true });
    const filePath = join(gamesDir, fileName);
    await writeFile(filePath, bytes);
    logger.info(
      'download',
      `已保存 ${filePath}（${(bytes.length / 1024 / 1024).toFixed(2)} MB，SWF 文件头校验通过）`
    );
    return {
      result: { source, gameId, name: fileName, path: filePath, sizeBytes: bytes.length },
      hash: createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    };
  }

  private async abort(ctx: TaskContext): Promise<void> {
    for (const action of ctx.abortActions) {
      await action().catch(() => undefined);
    }
  }

  private setProgress(
    ctx: TaskContext,
    phase: DownloadPhase,
    bytes?: { receivedBytes?: number; totalBytes?: number; chunkCount?: number }
  ): void {
    ctx.task.phase = phase;
    if (bytes?.receivedBytes !== undefined) ctx.task.receivedBytes = bytes.receivedBytes;
    if (bytes?.totalBytes !== undefined) ctx.task.totalBytes = bytes.totalBytes;
    if (bytes?.chunkCount !== undefined) ctx.task.chunkCount = bytes.chunkCount;
    // 下载中的进度按字节密集刷新，节流；其余阶段（含收尾）立即推送
    this.publish(ctx, phase !== 'downloading');
  }

  /** 收尾：写入终态并推送 */
  private finish(
    ctx: TaskContext,
    status: DownloadTaskStatus,
    error: string | null = null,
    result: DownloadResult | null = null
  ): void {
    ctx.task.status = status;
    ctx.task.error = error;
    ctx.task.result = result;
    if (result) {
      ctx.task.receivedBytes = result.sizeBytes;
      ctx.task.totalBytes = result.sizeBytes;
      ctx.task.phase = 'saving';
    }
    this.publish(ctx, true);
    if (error) {
      logger.warn('download', `${ctx.task.source} 游戏 ${ctx.task.gameId} 下载失败：${error}`);
    }
  }

  private publish(ctx: TaskContext, force: boolean): void {
    if (ctx.removed) return;
    const now = Date.now();
    if (!force && now - ctx.lastPublish < PROGRESS_INTERVAL_MS) return;
    ctx.lastPublish = now;
    this.emitTask({ ...ctx.task });
  }
}
