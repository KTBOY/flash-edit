/** Ruffle 播放器元素与全局 API 的最小类型声明（官方包未发布完整 .d.ts） */
export interface RufflePlayerMetadata {
  width?: number
  height?: number
  framerate?: number
  flashVersion?: string
  totalTime?: number
}

export interface RuffleLoadOptions {
  url?: string
  data?: Uint8Array
  allowScriptAccess?: boolean
  [key: string]: unknown
}

export interface RufflePlayerElement extends HTMLElement {
  load(options: RuffleLoadOptions): Promise<void>
  play(): void
  pause(): void
  isPlaying(): boolean
  volume?: number
  metadata?: RufflePlayerMetadata
  reload?(): void
}

export interface RufflePlayerApi {
  config?: Record<string, unknown>
  newest?(): { createPlayer(): RufflePlayerElement }
}

declare global {
  interface Window {
    RufflePlayer?: RufflePlayerApi
  }
}
