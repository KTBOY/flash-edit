/**
 * 变速齿轮（TimeScaler）。
 *
 * 原理：包装 performance.now / Date.now，让 WASM 侧（Ruffle）读到的"游戏时间"
 * 按倍率缩放，从而加速/减速以帧循环与计时器驱动的游戏逻辑。
 * 说明：Ruffle 的 AS Date 类走 OS 时钟，不受影响；主要影响帧率驱动与
 * getTimer/setTimeout/setInterval 类逻辑，对绝大多数 Flash 游戏有效。
 *
 * 必须在加载 Ruffle 之前 install，确保播放器绑定到包装后的时间函数。
 */
export interface TimeHost {
  performance: Performance
  Date: DateConstructor
}

export const MIN_SPEED = 0.1
export const MAX_SPEED = 10

export class TimeScaler {
  private speed = 1
  private realBase = 0
  private scaledBase = 0
  private installed = false
  private realNowFn: (() => number) | null = null

  get currentSpeed(): number {
    return this.speed
  }

  get isInstalled(): boolean {
    return this.installed
  }

  install(host: TimeHost = globalThis): void {
    if (this.installed) return
    this.installed = true

    const origNow = host.performance.now.bind(host.performance)
    this.realNowFn = origNow
    this.realBase = origNow()
    this.scaledBase = this.realBase

    const scaler = this // eslint-disable-line @typescript-eslint/no-this-alias -- 包装闭包需要捕获实例
    try {
      ;(host.performance as unknown as { now: () => number }).now = () => scaler.scale(origNow())
    } catch {
      // performance.now 不可写时仅保留 Date.now 补丁
    }
    try {
      const origDateNow = host.Date.now.bind(host.Date)
      host.Date.now = () => scaler.scale(origDateNow())
    } catch {
      // 忽略
    }
  }

  /** 未被缩放的真实时间（扫描耗时统计等内部用途） */
  realNow(): number {
    return this.realNowFn ? this.realNowFn() : Date.now()
  }

  setSpeed(speed: number): void {
    const next = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed))
    if (!this.installed || next === this.speed) return
    // 换挡时重新校准基准，保证累计时间连续
    const real = this.realNow()
    this.scaledBase = this.scale(real)
    this.realBase = real
    this.speed = next
  }

  private scale(real: number): number {
    return this.scaledBase + (real - this.realBase) * this.speed
  }
}
