import { describe, expect, it } from 'vitest'
import { TimeScaler } from '../time-scaler'

class FakeClock {
  t = 1_000_000
  now(): number {
    return this.t
  }
}

function createHost(clock: FakeClock): { performance: Performance; Date: DateConstructor } {
  return {
    performance: { now: () => clock.now() } as unknown as Performance,
    Date: { now: () => clock.now() } as unknown as DateConstructor
  }
}

describe('TimeScaler 变速齿轮', () => {
  it('速度 1 时时间原样通过', () => {
    const clock = new FakeClock()
    const host = createHost(clock)
    const scaler = new TimeScaler()
    scaler.install(host)

    expect(scaler.currentSpeed).toBe(1)
    expect(host.performance.now()).toBe(clock.t)
    expect(host.Date.now()).toBe(clock.t)
  })

  it('速度 2 时时间按倍率放大', () => {
    const clock = new FakeClock()
    const host = createHost(clock)
    const scaler = new TimeScaler()
    scaler.install(host)

    scaler.setSpeed(2)
    clock.t += 100
    expect(host.performance.now()).toBe(1_000_000 + 200)
    expect(host.Date.now()).toBe(1_000_000 + 200)
  })

  it('换挡保持时间连续', () => {
    const clock = new FakeClock()
    const host = createHost(clock)
    const scaler = new TimeScaler()
    scaler.install(host)

    scaler.setSpeed(3)
    clock.t += 100 // 缩放时间应前进 300
    scaler.setSpeed(1)
    clock.t += 100 // 回到 1x，从当前缩放值继续
    const scaled = host.performance.now()
    expect(scaled).toBe(1_000_000 + 300 + 100)
  })

  it('速度限制在合法范围内', () => {
    const scaler = new TimeScaler()
    scaler.install(createHost(new FakeClock()))
    scaler.setSpeed(100)
    expect(scaler.currentSpeed).toBe(10)
    scaler.setSpeed(0)
    expect(scaler.currentSpeed).toBe(0.1)
  })

  it('install 幂等', () => {
    const clock = new FakeClock()
    const host = createHost(clock)
    const scaler = new TimeScaler()
    scaler.install(host)
    scaler.install(host)
    scaler.setSpeed(2)
    clock.t += 50
    expect(host.performance.now()).toBe(1_000_000 + 100)
  })
})
