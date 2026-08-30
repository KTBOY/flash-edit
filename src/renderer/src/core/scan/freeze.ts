import type { ValueType } from '@shared/types'

/**
 * 数值锁定（冻结）。以固定周期把锁定条目的值写回内存，
 * 覆盖游戏每帧的改写，实现"无敌/金钱不减"等效果。
 */
export interface FreezeTarget {
  memId: number
  offset: number
  type: ValueType
  value: number
  locked: boolean
}

export interface FreezeWriter {
  writeAt(memId: number, offset: number, type: ValueType, value: number): boolean
}

const FREEZE_INTERVAL_MS = 50

export class FreezeManager {
  private targets: FreezeTarget[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly writer: FreezeWriter) {}

  /** 与外部状态全量同步（以 cheat store 为唯一事实来源） */
  sync(targets: FreezeTarget[]): void {
    this.targets = targets
    const hasLocked = targets.some((t) => t.locked)
    if (hasLocked && this.timer === null) {
      this.timer = setInterval(() => this.tick(), FREEZE_INTERVAL_MS)
    } else if (!hasLocked && this.timer !== null) {
      this.stop()
    }
  }

  /** 手动执行一轮写回（测试用） */
  tick(): void {
    for (const target of this.targets) {
      if (target.locked) this.writer.writeAt(target.memId, target.offset, target.type, target.value)
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  dispose(): void {
    this.stop()
    this.targets = []
  }
}
