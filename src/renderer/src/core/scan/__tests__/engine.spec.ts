import { describe, expect, it } from 'vitest'
import type { ScanRequest } from '@shared/types'
import { ScanEngine, formatAddress, type MemoryProvider } from '../engine'

function createFakeProvider(size = 4096, extraMemories: number[] = []): {
  buffer: ArrayBuffer
  provider: MemoryProvider
  extraBuffers: ArrayBuffer[]
} {
  const buffer = new ArrayBuffer(size)
  const extraBuffers = extraMemories.map((n) => new ArrayBuffer(n))
  const provider: MemoryProvider = {
    listMemories: () => [
      { id: 0, label: 'main', byteLength: buffer.byteLength },
      ...extraBuffers.map((b, i) => ({ id: i + 1, label: `extra${i}`, byteLength: b.byteLength }))
    ],
    getBuffer: (memId: number) =>
      memId === 0 ? buffer : (extraBuffers[memId - 1] as ArrayBuffer | undefined) ?? null
  }
  return { buffer, provider, extraBuffers }
}

const writeF64 = (buffer: ArrayBuffer, offset: number, value: number) =>
  new DataView(buffer).setFloat64(offset, value, true)
const writeI32 = (buffer: ArrayBuffer, offset: number, value: number) =>
  new DataView(buffer).setInt32(offset, value, true)
const writeF32 = (buffer: ArrayBuffer, offset: number, value: number) =>
  new DataView(buffer).setFloat32(offset, value, true)
const readF64 = (buffer: ArrayBuffer, offset: number) =>
  new DataView(buffer).getFloat64(offset, true)

function req(over: Partial<ScanRequest> = {}): ScanRequest {
  return { op: 'exact', types: ['f64', 'i32', 'f32'], tolerance: 1e-6, ...over }
}

describe('ScanEngine 精确扫描', () => {
  it('首次扫描按类型找到全部匹配地址', async () => {
    const { buffer, provider } = createFakeProvider()
    writeF64(buffer, 64, 100)
    writeI32(buffer, 128, 100)
    writeF32(buffer, 192, 100)
    const engine = new ScanEngine(provider)

    const summary = await engine.firstScan(req({ value: 100 }))
    expect(summary.total).toBe(3)
    expect(engine.hasResults).toBe(true)

    const rows = engine.getResults(0, 100)
    const offsets = rows.map((r) => parseInt(r.address.split('0x')[1], 16))
    expect(offsets).toContain(64)
    expect(offsets).toContain(128)
    expect(offsets).toContain(192)
    expect(rows.every((r) => r.value === 100)).toBe(true)
  })

  it('再次扫描可收敛到唯一地址，并支持写入', async () => {
    const { buffer, provider } = createFakeProvider()
    writeF64(buffer, 64, 100)
    writeI32(buffer, 128, 100)
    const engine = new ScanEngine(provider)
    await engine.firstScan(req({ value: 100 }))

    // 游戏中血量 100 → 55（只有 f64 那一处变化）
    writeF64(buffer, 64, 55)
    const narrowed = await engine.nextScan(req({ value: 55 }))
    expect(narrowed.total).toBe(1)
    const row = engine.getResults(0, 10)[0]
    expect(row.address).toBe(formatAddress(0, 64))
    expect(row.type).toBe('f64')

    // 写入新值 9999
    expect(engine.writeCandidate(row.index, 9999)).toBe(true)
    expect(readF64(buffer, 64)).toBe(9999)
  })

  it('浮点容差对 f32 生效', async () => {
    const { buffer, provider } = createFakeProvider()
    writeF32(buffer, 32, 0.1) // f32(0.1) ≈ 0.100000001490116
    const engine = new ScanEngine(provider)

    const summary = await engine.firstScan(req({ value: 0.1, types: ['f32'] }))
    expect(summary.total).toBe(1)
  })

  it('between 区间扫描', async () => {
    const { buffer, provider } = createFakeProvider()
    writeI32(buffer, 0, 95)
    writeI32(buffer, 4, 105)
    writeI32(buffer, 8, 111)
    const engine = new ScanEngine(provider)
    const summary = await engine.firstScan(
      req({ op: 'between', value: 90, value2: 110, types: ['i32'] })
    )
    expect(summary.total).toBe(2)
  })
})

describe('ScanEngine 快照（未知初始值）流程', () => {
  it('unknown → increased 收敛到变化地址，随后快照释放', async () => {
    const { buffer, provider } = createFakeProvider()
    writeF64(buffer, 64, 100)
    const engine = new ScanEngine(provider)

    const first = await engine.firstScan(req({ op: 'unknown' }))
    expect(first.total).toBe(0)
    expect(engine.hasSnapshot).toBe(true)

    writeF64(buffer, 64, 150)
    const next = await engine.nextScan(req({ op: 'increased' }))
    // f64 写入会在 i32/f32 类型视图的字节重叠上产生伴生命中，属于预期行为
    expect(next.total).toBeGreaterThanOrEqual(1)
    expect(engine.hasSnapshot).toBe(false) // 已产生候选，快照释放

    // 用精确值进一步收敛到唯一地址
    const exact = await engine.nextScan(req({ value: 150 }))
    expect(exact.total).toBe(1)
    const row = engine.getResults(0, 10)[0]
    expect(row.address).toBe(formatAddress(0, 64))
    expect(row.value).toBe(150)
  })

  it('increased by 指定变化量', async () => {
    const { buffer, provider } = createFakeProvider()
    writeI32(buffer, 0, 100)
    writeI32(buffer, 4, 200)
    const engine = new ScanEngine(provider)
    await engine.firstScan(req({ op: 'unknown', types: ['i32'] }))

    writeI32(buffer, 0, 130) // +30
    writeI32(buffer, 4, 260) // +60
    const next = await engine.nextScan(req({ op: 'increased', value: 30, types: ['i32'] }))
    expect(next.total).toBe(1)
    expect(engine.getResults(0, 10)[0].value).toBe(130)
  })

  it('unchanged 保留未变化地址（含零填充）', async () => {
    const { buffer, provider } = createFakeProvider()
    writeI32(buffer, 0, 100)
    const engine = new ScanEngine(provider)
    await engine.firstScan(req({ op: 'unknown', types: ['i32'] }))

    const next = await engine.nextScan(req({ op: 'unchanged', types: ['i32'] }))
    // 全内存 i32 槽位都未变
    expect(next.total).toBe(buffer.byteLength / 4)
    const offsets = engine
      .getResults(0, next.total)
      .map((r) => parseInt(r.address.split('0x')[1], 16))
    expect(offsets).toContain(0)
  })
})

describe('ScanEngine 其他能力', () => {
  it('undo 恢复上一次过滤前的候选', async () => {
    const { buffer, provider } = createFakeProvider()
    writeI32(buffer, 0, 100)
    writeI32(buffer, 4, 100)
    const engine = new ScanEngine(provider)
    await engine.firstScan(req({ value: 100, types: ['i32'] }))
    expect(engine.candidateCount).toBe(2)

    writeI32(buffer, 0, 7)
    await engine.nextScan(req({ value: 7, types: ['i32'] }))
    expect(engine.candidateCount).toBe(1)

    expect(engine.undo()).toBe(true)
    expect(engine.candidateCount).toBe(2)
    expect(engine.getResults(0, 10).every((r) => r.value === 7)).toBe(false)
  })

  it('writeAll 覆盖全部候选', async () => {
    const { buffer, provider } = createFakeProvider()
    writeI32(buffer, 0, 100)
    writeI32(buffer, 4, 100)
    const engine = new ScanEngine(provider)
    await engine.firstScan(req({ value: 100, types: ['i32'] }))

    const written = engine.writeAll(555)
    expect(written).toBe(2)
    expect(engine.getResults(0, 10).every((r) => r.value === 555)).toBe(true)
  })

  it('候选数达到上限时终止并标记 limitReached', async () => {
    const { buffer, provider } = createFakeProvider()
    for (let i = 0; i < 10; i++) writeI32(buffer, i * 4, 100)
    const engine = new ScanEngine(provider, { maxCandidates: 3 })

    const summary = await engine.firstScan(req({ value: 100, types: ['i32'] }))
    expect(summary.limitReached).toBe(true)
    expect(summary.total).toBe(3)
  })

  it('多内存块扫描', async () => {
    const { buffer, extraBuffers, provider } = createFakeProvider(1024, [1024])
    writeI32(buffer, 0, 42)
    writeI32(extraBuffers[0], 16, 42)
    const engine = new ScanEngine(provider)

    const summary = await engine.firstScan(req({ value: 42, types: ['i32'] }))
    expect(summary.scannedMemories).toBe(2)
    expect(summary.total).toBe(2)
    expect(engine.getResults(0, 10).map((r) => r.memId).sort()).toEqual([0, 1])
  })

  it('readValue 对越界/不可读地址返回 null', async () => {
    const { buffer, provider } = createFakeProvider()
    writeF64(buffer, 0, 1)
    const engine = new ScanEngine(provider)
    expect(engine.readValue(0, 0, 'f64')).toBe(1)
    expect(engine.readValue(0, 4096, 'f64')).toBeNull()
    expect(engine.readValue(99, 0, 'f64')).toBeNull()
  })
})
