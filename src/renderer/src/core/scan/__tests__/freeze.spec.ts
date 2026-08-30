import { describe, expect, it, vi } from 'vitest'
import { FreezeManager, type FreezeWriter } from '../freeze'

function createWriter(): FreezeWriter & { writes: { memId: number; offset: number; value: number }[] } {
  const writes: { memId: number; offset: number; value: number }[] = []
  return {
    writes,
    writeAt: (memId, offset, _type, value) => {
      writes.push({ memId, offset, value })
      return true
    }
  }
}

describe('FreezeManager 数值锁定', () => {
  it('tick 只写回锁定条目', () => {
    const writer = createWriter()
    const manager = new FreezeManager(writer)
    manager.sync([
      { memId: 0, offset: 64, type: 'f64', value: 9999, locked: true },
      { memId: 0, offset: 128, type: 'i32', value: 1, locked: false }
    ])
    manager.tick()
    expect(writer.writes).toEqual([{ memId: 0, offset: 64, value: 9999 }])
  })

  it('无锁定条目时定时器停止', () => {
    vi.useFakeTimers()
    try {
      const writer = createWriter()
      const manager = new FreezeManager(writer)
      manager.sync([{ memId: 0, offset: 0, type: 'i32', value: 1, locked: true }])
      expect(vi.getTimerCount()).toBe(1)

      manager.sync([{ memId: 0, offset: 0, type: 'i32', value: 1, locked: false }])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('定时器周期性写回', () => {
    vi.useFakeTimers()
    try {
      const writer = createWriter()
      const manager = new FreezeManager(writer)
      manager.sync([{ memId: 0, offset: 8, type: 'i32', value: 42, locked: true }])
      vi.advanceTimersByTime(160)
      expect(writer.writes.length).toBeGreaterThanOrEqual(3)
      manager.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
