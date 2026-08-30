import type { RufflePlayerElement, RufflePlayerMetadata } from '@renderer/types/ruffle'
import { createRufflePlayer } from './loader'

/**
 * 播放器生命周期控制器：
 * 拥有 ruffle-player 元素的创建 / 加载 / 播放控制 / 销毁，
 * 对上层暴露与具体播放器实现无关的事件回调。
 */

export interface PlayerSource {
  name: string
  /** 二进制内容（本地文件/拖拽），与 url 二选一 */
  data?: Uint8Array
  url?: string
}

export interface PlayerControllerEvents {
  onLoaded?(metadata: RufflePlayerMetadata): void
  onFailed?(message: string): void
  onPlayingChange?(playing: boolean): void
}

export class PlayerController {
  private container: HTMLElement | null = null
  private player: RufflePlayerElement | null = null
  private source: PlayerSource | null = null
  private loadSeq = 0
  private events: PlayerControllerEvents = {}

  setEvents(events: PlayerControllerEvents): void {
    this.events = events
  }

  /** 绑定宿主容器；容器随 React 重挂载时自动恢复当前游戏 */
  attach(container: HTMLElement): void {
    if (this.container === container && this.player?.isConnected) return
    this.container = container
    if (this.source) void this.reload()
  }

  detach(): void {
    this.container = null
  }

  get isLoaded(): boolean {
    return this.player !== null && this.player.isConnected
  }

  get isPlaying(): boolean {
    try {
      return this.player?.isPlaying() ?? false
    } catch {
      return false
    }
  }

  async load(source: PlayerSource): Promise<void> {
    this.source = source
    await this.reload()
  }

  /** 销毁并按当前 source 重建播放器 */
  async reload(): Promise<void> {
    const source = this.source
    const container = this.container
    if (!source || !container) return

    const seq = ++this.loadSeq
    this.destroyPlayer()
    try {
      const player = await createRufflePlayer(container)
      if (seq !== this.loadSeq || this.container !== container) {
        player.remove()
        return
      }
      this.player = player
      await player.load({
        ...(source.data ? { data: source.data } : {}),
        ...(source.url ? { url: source.url } : {}),
        allowScriptAccess: false
      })
      if (seq !== this.loadSeq) return
      this.events.onLoaded?.(player.metadata ?? {})
      this.events.onPlayingChange?.(this.isPlaying)
    } catch (error) {
      if (seq === this.loadSeq) {
        this.destroyPlayer()
        const message = error instanceof Error ? error.message : String(error)
        this.events.onFailed?.(message)
      }
    }
  }

  play(): void {
    try {
      this.player?.play()
      this.events.onPlayingChange?.(this.isPlaying)
    } catch {
      // 播放器尚未就绪时忽略
    }
  }

  pause(): void {
    try {
      this.player?.pause()
      this.events.onPlayingChange?.(this.isPlaying)
    } catch {
      // 忽略
    }
  }

  togglePlay(): void {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  setVolume(volume: number): void {
    if (this.player && 'volume' in this.player) {
      this.player.volume = Math.min(1, Math.max(0, volume))
    }
  }

  requestFullscreen(): void {
    void this.container?.requestFullscreen?.().catch(() => undefined)
  }

  /**
   * 截图（实验性）。Ruffle 使用 WebGL 渲染且未开启 preserveDrawingBuffer，
   * 在部分帧可能捕获为空白；失败返回 null。
   */
  screenshot(): string | null {
    try {
      const canvas = this.container?.querySelector('canvas')
      if (!canvas) return null
      const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png')
      return dataUrl.length > 'data:image/png;base64,'.length ? dataUrl : null
    } catch {
      return null
    }
  }

  destroy(): void {
    this.loadSeq += 1
    this.destroyPlayer()
    this.source = null
    this.events = {}
  }

  private destroyPlayer(): void {
    if (this.player) {
      try {
        this.player.remove()
      } catch {
        // 已移除时忽略
      }
      this.player = null
    }
  }
}
