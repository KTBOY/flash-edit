import { existsSync, watch, type FSWatcher } from 'node:fs'
import { logger } from '../infra/logger'

/**
 * 下载目录文件监听：目录内文件被外部增删/移动时触发回调，
 * 主进程据此向渲染层推送刷新事件，游戏库列表不再依赖应用内操作才会更新。
 *
 * fs.watch 对一次外部操作常连发多条事件，统一防抖合并。
 * 目录被外部整体删除时句柄会失效且不一定触发 error 事件（Windows 下常静默死亡），
 * 因此除事件外还靠周期自检兜底：每个周期核对目录存在性——
 * 目录被删 → 立即通知一次（渲染层把相关记录标记为丢失）；
 * 目录（重新）出现 → 重新挂载并通知一次；稳定期无条件重挂，
 * 从任何句柄失效形态中恢复。监听本身不创建目录（避免把用户删掉的
 * 下载目录又悄悄建回来），目录由首次下载落盘时创建，随后自动恢复监听。
 */
export class LibraryWatcher {
  private watcher: FSWatcher | null = null
  private dir: string | null = null
  private started = false
  /** 上次核对时目录是否存在，用于识别出现/消失转换 */
  private dirWasMissing = false
  private debounceTimer: NodeJS.Timeout | null = null
  private checkTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly onChange: () => void,
    private readonly debounceMs = 300,
    private readonly checkMs = 5000
  ) {}

  /** 监听指定目录；目录变化时重挂，重复传入生效中的同一目录时忽略 */
  start(dir: string): void {
    if (this.started && dir === this.dir) return
    this.stop()
    this.started = true
    this.dir = dir
    this.mount()
  }

  stop(): void {
    this.started = false
    this.dir = null
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.checkTimer) clearTimeout(this.checkTimer)
    this.debounceTimer = null
    this.checkTimer = null
    this.closeWatcher()
  }

  private closeWatcher(): void {
    this.watcher?.close()
    this.watcher = null
  }

  private mount(): void {
    if (!this.dir) return
    this.closeWatcher()
    this.dirWasMissing = !existsSync(this.dir)
    if (!this.dirWasMissing) this.watch()
    this.scheduleCheck()
  }

  private watch(): void {
    if (!this.dir) return
    try {
      this.watcher = watch(this.dir, { persistent: false }, () => this.scheduleNotify())
      this.watcher.on('error', (error) => {
        logger.warn('games', `下载目录监听异常：${this.dir}`, error)
        this.closeWatcher()
      })
    } catch (error) {
      logger.warn('games', `监听下载目录失败：${this.dir}`, error)
      this.closeWatcher()
    }
  }

  /** 周期自检：目录消失/出现时通知并调整挂载，稳定期无条件重挂防句柄静默失效 */
  private scheduleCheck(): void {
    if (this.checkTimer || !this.dir) return
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null
      this.check()
    }, this.checkMs)
  }

  private check(): void {
    if (!this.dir) return
    const exists = existsSync(this.dir)
    if (!exists) {
      this.closeWatcher()
      if (!this.dirWasMissing) {
        this.dirWasMissing = true
        this.onChange()
      }
    } else if (this.dirWasMissing || !this.watcher) {
      this.mount()
      this.onChange()
    } else {
      this.closeWatcher()
      this.watch()
    }
    this.scheduleCheck()
  }

  private scheduleNotify(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.onChange()
    }, this.debounceMs)
  }
}
