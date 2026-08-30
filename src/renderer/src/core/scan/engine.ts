import type { ScanRequest, ScanResultRow, ScanSummary, ValueType } from '@shared/types'

/**
 * 内存扫描引擎（Cheat Engine 工作流）：
 *   首扫（精确值/介于 → 直接全量比对；未知初始 → 建立全量快照）
 *   → 玩家改变数值 → 再扫（增大/减小/变动/精确）收敛候选
 *   → 写入 / 锁定。
 *
 * 引擎通过 MemoryProvider 抽象访问内存，不直接依赖 WebAssembly，
 * 因此可在 Node 环境用普通 ArrayBuffer 完整单元测试。
 */

export interface MemoryInfo {
  id: number
  label: string
  byteLength: number
}

export interface MemoryProvider {
  listMemories(): MemoryInfo[]
  /** 返回最新 buffer；内存不存在或已被 detach 时返回 null。禁止缓存返回值。 */
  getBuffer(memId: number): ArrayBuffer | null
}

export interface ScanProgress {
  phase: string
  percent: number
}

export type ProgressCallback = (progress: ScanProgress) => void

export interface EngineOptions {
  /** 每个进度切片扫描的字节数 */
  chunkBytes?: number
  /** 候选地址上限，超出后终止扫描并标记 limitReached */
  maxCandidates?: number
  /** 时间源（注入以便测试，默认 performance.now） */
  nowFn?: () => number
}

// 内部类型编码：与 shared VALUE_TYPE_META 的 key 对应
const CODE_TYPES: readonly ValueType[] = ['f64', 'f32', 'i32', 'i16', 'i8']
const TYPE_CODES: Record<ValueType, number> = { f64: 0, f32: 1, i32: 2, i16: 3, i8: 4 }
const TYPE_SIZES: readonly number[] = [8, 4, 4, 2, 1]

const CODE_F64 = 0
const CODE_F32 = 1

interface CandidateChunk {
  memId: number
  type: Uint8Array
  offset: Uint32Array
  /** 上一次扫描时的值（统一以 double 记录用于展示与比较） */
  value: Float64Array
  count: number
}

const CHUNK_CAP = 65536
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_CANDIDATES = 5_000_000
const UNDO_LIMIT = 5

interface UndoState {
  chunks: CandidateChunk[]
  total: number
  snapshots: Map<number, Uint8Array>
}

export class ScanEngine {
  private chunks: CandidateChunk[] = []
  private total = 0
  private snapshots = new Map<number, Uint8Array>()
  private undoStack: UndoState[] = []
  private limitReached = false
  private scanning = false
  private readonly chunkBytes: number
  private readonly maxCandidates: number
  private readonly nowFn: () => number

  constructor(private readonly provider: MemoryProvider, options: EngineOptions = {}) {
    this.chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
    this.maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES
    this.nowFn = options.nowFn ?? (() => performance.now())
  }

  get candidateCount(): number {
    return this.total
  }

  get hasResults(): boolean {
    return this.total > 0
  }

  get hasSnapshot(): boolean {
    return this.snapshots.size > 0
  }

  get isScanning(): boolean {
    return this.scanning
  }

  /** 清空会话（候选、快照、撤销栈） */
  reset(): void {
    this.chunks = []
    this.total = 0
    this.snapshots.clear()
    this.undoStack = []
    this.limitReached = false
  }

  /** 撤销上一次"再扫描"（最多 5 步），返回是否成功 */
  undo(): boolean {
    const state = this.undoStack.pop()
    if (!state) return false
    this.chunks = state.chunks
    this.total = state.total
    this.snapshots = state.snapshots
    this.limitReached = false
    return true
  }

  /**
   * 首次扫描。op 为 exact/between 时直接全量比对；
   * 其余 op（增大/减小/变动/未知）自动转为建立基线快照，等待下一次再扫。
   */
  async firstScan(req: ScanRequest, onProgress?: ProgressCallback): Promise<ScanSummary> {
    this.ensureNotScanning()
    this.reset()
    this.scanning = true
    try {
      if (req.op === 'exact' || req.op === 'between') {
        return await this.sweepAll(req, 'value', onProgress)
      }
      return await this.takeSnapshots(onProgress)
    } finally {
      this.scanning = false
    }
  }

  /**
   * 再次扫描。存在候选时按候选过滤；仅有快照（未知初始流程）时做全量快照比对。
   */
  async nextScan(req: ScanRequest, onProgress?: ProgressCallback): Promise<ScanSummary> {
    this.ensureNotScanning()
    if (this.total === 0 && this.snapshots.size === 0) {
      throw new Error('请先进行首次扫描')
    }
    this.scanning = true
    this.limitReached = false
    try {
      if (this.total > 0) {
        return await this.filterCandidates(req, onProgress)
      }
      const summary = await this.sweepAll(req, 'snapshot', onProgress)
      // 快照比对完成且已有候选后，快照不再需要，及时释放内存
      if (this.total > 0) this.snapshots.clear()
      return summary
    } finally {
      this.scanning = false
    }
  }

  /** 分页读取结果（供表格渲染，避免一次性构造数百万行） */
  getResults(start: number, limit: number): ScanResultRow[] {
    const rows: ScanResultRow[] = []
    let index = 0
    for (const chunk of this.chunks) {
      for (let i = 0; i < chunk.count; i++) {
        if (index >= start && rows.length < limit) {
          rows.push({
            index,
            memId: chunk.memId,
            address: formatAddress(chunk.memId, chunk.offset[i]),
            type: CODE_TYPES[chunk.type[i]],
            value: chunk.value[i]
          })
        }
        index += 1
        if (rows.length >= limit && index >= start + limit) return rows
      }
    }
    return rows
  }

  /** 按全局序号取候选定位信息 */
  getCandidateAt(index: number): { memId: number; offset: number; type: ValueType } | null {
    let cursor = 0
    for (const chunk of this.chunks) {
      if (index < cursor + chunk.count) {
        const i = index - cursor
        return { memId: chunk.memId, offset: chunk.offset[i], type: CODE_TYPES[chunk.type[i]] }
      }
      cursor += chunk.count
    }
    return null
  }

  /** 读取指定地址当前值（配置恢复时做失效校验用） */
  readValue(memId: number, offset: number, type: ValueType): number | null {
    const buffer = this.provider.getBuffer(memId)
    if (!buffer) return null
    const code = TYPE_CODES[type]
    if (offset < 0 || offset + TYPE_SIZES[code] > buffer.byteLength) return null
    return readValueAt(new DataView(buffer), offset, code)
  }

  /** 写入指定地址（锁定与修改共用） */
  writeAt(memId: number, offset: number, type: ValueType, value: number): boolean {
    const buffer = this.provider.getBuffer(memId)
    if (!buffer) return false
    const code = TYPE_CODES[type]
    if (offset < 0 || offset + TYPE_SIZES[code] > buffer.byteLength) return false
    writeValueAt(new DataView(buffer), offset, code, value)
    return true
  }

  /** 将某个候选写入新值，返回是否成功 */
  writeCandidate(index: number, value: number): boolean {
    const candidate = this.getCandidateAt(index)
    if (!candidate) return false
    const ok = this.writeAt(candidate.memId, candidate.offset, candidate.type, value)
    if (ok) this.updateCandidateValue(index, value)
    return ok
  }

  /** 将所有候选写入同一个值（对"锁定即无敌"类场景非常有效），返回成功数 */
  writeAll(value: number): number {
    let written = 0
    for (const chunk of this.chunks) {
      const buffer = this.provider.getBuffer(chunk.memId)
      const dv = buffer ? new DataView(buffer) : null
      for (let i = 0; i < chunk.count; i++) {
        const code = chunk.type[i]
        const offset = chunk.offset[i]
        if (dv && offset + TYPE_SIZES[code] <= dv.byteLength) {
          writeValueAt(dv, offset, code, value)
          chunk.value[i] = value
          written += 1
        }
      }
    }
    return written
  }

  private updateCandidateValue(index: number, value: number): void {
    let cursor = 0
    for (const chunk of this.chunks) {
      if (index < cursor + chunk.count) {
        chunk.value[index - cursor] = value
        return
      }
      cursor += chunk.count
    }
  }

  private ensureNotScanning(): void {
    if (this.scanning) throw new Error('扫描正在进行中')
  }

  // ---------- 内部扫描实现 ----------

  private async sweepAll(
    req: ScanRequest,
    mode: 'value' | 'snapshot',
    onProgress?: ProgressCallback
  ): Promise<ScanSummary> {
    const start = this.nowFn()
    const memories = this.provider.listMemories()
    const totalBytes = memories.reduce((sum, m) => sum + m.byteLength, 0) || 1
    let doneBytes = 0
    let scannedBytes = 0
    let scannedMemories = 0

    for (const mem of memories) {
      const buffer = this.provider.getBuffer(mem.id)
      if (!buffer) {
        doneBytes += mem.byteLength
        continue
      }
      scannedMemories += 1
      const snapshot = mode === 'snapshot' ? this.snapshots.get(mem.id) : undefined
      if (mode === 'snapshot' && !snapshot) {
        doneBytes += buffer.byteLength
        continue
      }
      const snapshotView = snapshot ? new DataView(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength) : null

      for (const type of req.types) {
        if (this.limitReached) break
        const code = TYPE_CODES[type]
        const size = TYPE_SIZES[code]
        const isFloat = code === CODE_F64 || code === CODE_F32
        const slotTotal = Math.floor(buffer.byteLength / size)
        const slotsPerChunk = Math.max(1, Math.floor(this.chunkBytes / size))
        const view = createTypedView(buffer, code)
        for (let slotStart = 0; slotStart < slotTotal && !this.limitReached; slotStart += slotsPerChunk) {
          const slotEnd = Math.min(slotStart + slotsPerChunk, slotTotal)
          for (let slot = slotStart; slot < slotEnd; slot++) {
            const offset = slot * size
            const current = view ? view.read(slot) : 0
            let matched: boolean
            if (mode === 'value') {
              matched = matchValue(current, req, isFloat)
            } else if (snapshotView) {
              const previous = readValueAt(snapshotView, offset, code)
              matched = matchAgainstPrevious(current, previous, req, isFloat)
            } else {
              matched = false
            }
            if (matched) this.addCandidate(mem.id, offset, code, current)
            if (this.limitReached) break
          }
          if (this.limitReached) break
          doneBytes += (slotEnd - slotStart) * size
          onProgress?.({
            phase: '扫描中',
            percent: Math.min(99.5, (doneBytes / totalBytes) * 100)
          })
          await yieldToEventLoop()
        }
      }
      scannedBytes += buffer.byteLength
    }

    return {
      total: this.total,
      scannedMemories,
      scannedBytes,
      durationMs: Math.max(1, Math.round(this.nowFn() - start)),
      limitReached: this.limitReached
    }
  }

  private async takeSnapshots(onProgress?: ProgressCallback): Promise<ScanSummary> {
    const start = this.nowFn()
    const memories = this.provider.listMemories()
    const totalBytes = memories.reduce((sum, m) => sum + m.byteLength, 0) || 1
    let doneBytes = 0
    let scannedBytes = 0
    let scannedMemories = 0

    this.snapshots.clear()
    for (const mem of memories) {
      const buffer = this.provider.getBuffer(mem.id)
      if (!buffer) {
        doneBytes += mem.byteLength
        continue
      }
      this.snapshots.set(mem.id, new Uint8Array(buffer.slice(0)))
      scannedMemories += 1
      scannedBytes += buffer.byteLength
      doneBytes += buffer.byteLength
      onProgress?.({ phase: '建立基线快照', percent: Math.min(99.5, (doneBytes / totalBytes) * 100) })
      await yieldToEventLoop()
    }
    return {
      total: 0,
      scannedMemories,
      scannedBytes,
      durationMs: Math.max(1, Math.round(this.nowFn() - start)),
      limitReached: false
    }
  }

  private async filterCandidates(
    req: ScanRequest,
    onProgress?: ProgressCallback
  ): Promise<ScanSummary> {
    const start = this.nowFn()
    const previousTotal = this.total
    this.pushUndo()
    // total 语义切换为"过滤后的候选数"，必须先清零
    this.total = 0

    const dataViews = new Map<number, DataView | null>()
    const nextChunks: CandidateChunk[] = []
    let processed = 0

    for (const chunk of this.chunks) {
      let dv = dataViews.get(chunk.memId)
      if (dv === undefined) {
        const buffer = this.provider.getBuffer(chunk.memId)
        dv = buffer ? new DataView(buffer) : null
        dataViews.set(chunk.memId, dv)
      }
      for (let i = 0; i < chunk.count; i++) {
        const code = chunk.type[i]
        const offset = chunk.offset[i]
        const previous = chunk.value[i]
        if (dv === null || offset + TYPE_SIZES[code] > dv.byteLength) continue
        const isFloat = code === CODE_F64 || code === CODE_F32
        const current = readValueAt(dv, offset, code)
        if (!matchAgainstPrevious(current, previous, req, isFloat)) continue
        if (this.total >= this.maxCandidates) {
          this.limitReached = true
          break
        }
        appendCandidate(nextChunks, chunk.memId, offset, code, current)
        this.total += 1
      }
      processed += chunk.count
      onProgress?.({
        phase: '过滤候选',
        percent: Math.min(99.5, (processed / Math.max(1, previousTotal)) * 100)
      })
      await yieldToEventLoop()
      if (this.limitReached) break
    }

    this.chunks = nextChunks
    return {
      total: this.total,
      scannedMemories: dataViews.size,
      scannedBytes: 0,
      durationMs: Math.max(1, Math.round(this.nowFn() - start)),
      limitReached: this.limitReached
    }
  }

  private addCandidate(memId: number, offset: number, code: number, value: number): void {
    if (this.total >= this.maxCandidates) {
      this.limitReached = true
      return
    }
    appendCandidate(this.chunks, memId, offset, code, value)
    this.total += 1
  }

  private pushUndo(): void {
    const chunks = this.chunks.map((chunk) => ({
      memId: chunk.memId,
      type: chunk.type.slice(0, chunk.count),
      offset: chunk.offset.slice(0, chunk.count),
      value: chunk.value.slice(0, chunk.count),
      count: chunk.count
    }))
    this.undoStack.push({ chunks, total: this.total, snapshots: new Map(this.snapshots) })
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
  }
}

// ---------- 纯函数 ----------

interface TypedSlotView {
  read(slot: number): number
}

function createTypedView(buffer: ArrayBuffer, code: number): TypedSlotView | null {
  switch (code) {
    case 0: {
      const view = new Float64Array(buffer, 0, Math.floor(buffer.byteLength / 8))
      return { read: (s) => view[s] }
    }
    case 1: {
      const view = new Float32Array(buffer, 0, Math.floor(buffer.byteLength / 4))
      return { read: (s) => view[s] }
    }
    case 2: {
      const view = new Int32Array(buffer, 0, Math.floor(buffer.byteLength / 4))
      return { read: (s) => view[s] }
    }
    case 3: {
      const view = new Int16Array(buffer, 0, Math.floor(buffer.byteLength / 2))
      return { read: (s) => view[s] }
    }
    case 4: {
      const view = new Uint8Array(buffer)
      return { read: (s) => view[s] }
    }
    default:
      return null
  }
}

/** 按类型读取值。调用方需保证对齐与越界安全 */
export function readValueAt(dv: DataView, offset: number, code: number): number {
  switch (code) {
    case 0:
      return dv.getFloat64(offset, true)
    case 1:
      return dv.getFloat32(offset, true)
    case 2:
      return dv.getInt32(offset, true)
    case 3:
      return dv.getInt16(offset, true)
    default:
      return dv.getInt8(offset)
  }
}

function writeValueAt(dv: DataView, offset: number, code: number, value: number): void {
  switch (code) {
    case 0:
      dv.setFloat64(offset, value, true)
      break
    case 1:
      dv.setFloat32(offset, value, true)
      break
    case 2:
      dv.setInt32(offset, value | 0, true)
      break
    case 3:
      dv.setInt16(offset, value | 0, true)
      break
    default:
      dv.setInt8(offset, value | 0)
      break
  }
}

/** 浮点相等：相对误差 + 绝对下限，避免 0 附近抖动 */
export function valuesEqual(a: number, b: number, tolerance: number, isFloat: boolean): boolean {
  if (!isFloat) return a === b
  const diff = Math.abs(a - b)
  return diff <= Math.max(tolerance * Math.abs(b), 1e-12)
}

function matchValue(value: number, req: ScanRequest, isFloat: boolean): boolean {
  switch (req.op) {
    case 'exact':
      return req.value !== undefined && valuesEqual(value, req.value, req.tolerance, isFloat)
    case 'between':
      return req.value !== undefined && req.value2 !== undefined && value >= req.value && value <= req.value2
    default:
      return false
  }
}

function matchAgainstPrevious(
  current: number,
  previous: number,
  req: ScanRequest,
  isFloat: boolean
): boolean {
  switch (req.op) {
    case 'exact':
      return req.value !== undefined && valuesEqual(current, req.value, req.tolerance, isFloat)
    case 'between':
      return (
        req.value !== undefined &&
        req.value2 !== undefined &&
        current >= req.value &&
        current <= req.value2
      )
    case 'increased': {
      if (req.value === undefined) return current > previous
      return current > previous && valuesEqual(current - previous, req.value, req.tolerance, isFloat)
    }
    case 'decreased': {
      if (req.value === undefined) return current < previous
      return current < previous && valuesEqual(previous - current, req.value, req.tolerance, isFloat)
    }
    case 'changed':
      return !valuesEqual(current, previous, req.tolerance, isFloat)
    case 'unchanged':
      return valuesEqual(current, previous, req.tolerance, isFloat)
    default:
      return false
  }
}

function appendCandidate(
  chunks: CandidateChunk[],
  memId: number,
  offset: number,
  code: number,
  value: number
): void {
  let chunk = chunks[chunks.length - 1]
  if (!chunk || chunk.count >= CHUNK_CAP || chunk.memId !== memId) {
    chunk = {
      memId,
      type: new Uint8Array(CHUNK_CAP),
      offset: new Uint32Array(CHUNK_CAP),
      value: new Float64Array(CHUNK_CAP),
      count: 0
    }
    chunks.push(chunk)
  }
  chunk.type[chunk.count] = code
  chunk.offset[chunk.count] = offset
  chunk.value[chunk.count] = value
  chunk.count += 1
}

export function formatAddress(memId: number, offset: number): string {
  return `M${memId}:0x${offset.toString(16).toUpperCase().padStart(8, '0')}`
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
