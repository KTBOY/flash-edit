import type { MemoryProvider, MemoryInfo } from '@renderer/core/scan/engine'

/**
 * WASM 内存追踪器。
 *
 * 原理：在加载 Ruffle 之前替换 WebAssembly.Memory / WebAssembly.Instance 全局构造器，
 * 捕获播放器创建的所有 WASM 线性内存。WASM 内存对 JS 暴露为可读写的 ArrayBuffer，
 * 这使得我们无需原生模块/管理员权限即可实现 Cheat Engine 式的数值扫描与修改。
 *
 * 注意：
 * - 非共享 Memory 在 grow 后旧 ArrayBuffer 会被 detach，因此 provider 每次都读取
 *   memory.buffer 的最新引用，绝不缓存。
 * - 使用覆盖构造器而不是 patch grow：构造期捕获一次，后续长度全部实时读取。
 */
export interface TrackedMemoryRecord {
  readonly id: number
  readonly label: string
  readonly memory: WebAssembly.Memory
}

export interface WasmHost {
  WebAssembly?: typeof WebAssembly
}

export class WasmMemoryTracker {
  private records: TrackedMemoryRecord[] = []
  private known = new WeakSet<WebAssembly.Memory>()
  private installed = false
  private nextId = 0

  get count(): number {
    return this.records.length
  }

  get totalBytes(): number {
    return this.records.reduce((sum, r) => sum + this.safeByteLength(r.memory), 0)
  }

  list(): readonly TrackedMemoryRecord[] {
    return this.records
  }

  findById(id: number): TrackedMemoryRecord | null {
    return this.records.find((r) => r.id === id) ?? null
  }

  /**
   * 安装全局补丁。必须在加载任何 WASM（尤其是 Ruffle）之前调用。
   * 幂等，可安全重复调用。
   */
  install(host: WasmHost = globalThis): void {
    if (this.installed) return
    const WA = host.WebAssembly
    if (!WA?.Memory || !WA?.Instance) return
    this.installed = true

    const tracker = this // eslint-disable-line @typescript-eslint/no-this-alias -- 补丁闭包需要捕获实例
    const NativeMemory = WA.Memory
    const NativeInstance = WA.Instance

    const register = (memory: WebAssembly.Memory): void => tracker.register(memory)

    // 1) 拦截 new WebAssembly.Memory(...)
    const PatchedMemory = function PatchedMemory(
      this: unknown,
      ...args: ConstructorParameters<typeof WebAssembly.Memory>
    ): WebAssembly.Memory {
      const memory = Reflect.construct(NativeMemory, args) as WebAssembly.Memory
      register(memory)
      return memory
    } as unknown as typeof WebAssembly.Memory
    PatchedMemory.prototype = NativeMemory.prototype

    // 2) 拦截 new WebAssembly.Instance(...)，扫描导出表中内置定义的 memory
    const PatchedInstance = function PatchedInstance(
      this: unknown,
      ...args: ConstructorParameters<typeof WebAssembly.Instance>
    ): WebAssembly.Instance {
      const instance = Reflect.construct(NativeInstance, args) as WebAssembly.Instance
      scanExports(instance, NativeMemory, register)
      return instance
    } as unknown as typeof WebAssembly.Instance
    PatchedInstance.prototype = NativeInstance.prototype

    try {
      WA.Memory = PatchedMemory
      WA.Instance = PatchedInstance
    } catch {
      // 某些环境下全局对象冻结，退化为仅扫描 instantiate 结果
    }

    // 3) 兜底：拦截 instantiate/instantiateStreaming，覆盖 wasm 模块内部定义内存的情况
    wrapAsyncMember(WA, 'instantiate', (result) => scanResult(result, NativeMemory, register))
    wrapAsyncMember(WA, 'instantiateStreaming', (result) =>
      scanResult(result, NativeMemory, register)
    )
  }

  private register(memory: WebAssembly.Memory): void {
    if (this.known.has(memory)) return
    this.known.add(memory)
    this.records.push({ id: this.nextId, label: `memory#${this.nextId}`, memory })
    this.nextId += 1
  }

  private safeByteLength(memory: WebAssembly.Memory): number {
    try {
      return memory.buffer.byteLength
    } catch {
      return 0
    }
  }
}

function scanExports(
  instance: WebAssembly.Instance,
  NativeMemory: typeof WebAssembly.Memory,
  register: (m: WebAssembly.Memory) => void
): void {
  const exports = instance?.exports
  if (!exports) return
  for (const value of Object.values(exports)) {
    if (value instanceof NativeMemory) register(value)
  }
}

function scanResult(
  result: unknown,
  NativeMemory: typeof WebAssembly.Memory,
  register: (m: WebAssembly.Memory) => void
): void {
  if (result instanceof NativeInstanceLike) {
    scanExports(result, NativeMemory, register)
    return
  }
  const holder = result as { instance?: WebAssembly.Instance } | null
  if (holder && typeof holder === 'object' && holder.instance) {
    scanExports(holder.instance, NativeMemory, register)
  }
}

// instantiate(bytes, imports) 直接返回 Instance，instantiate(bytes...) 返回 {module, instance}
const NativeInstanceLike = WebAssembly.Instance

function wrapAsyncMember<
  K extends 'instantiate' | 'instantiateStreaming',
  R extends Promise<unknown>
>(wa: typeof WebAssembly, key: K, afterResolve: (result: unknown) => void): void {
  const original = wa[key] as (...args: unknown[]) => R
  if (typeof original !== 'function') return
  const wrapped = async function (...args: unknown[]): Promise<unknown> {
    const result = await (original as unknown as (...a: unknown[]) => Promise<unknown>).apply(wa, args)
    try {
      afterResolve(result)
    } catch {
      // 扫描失败不影响正常实例化
    }
    return result
  }
  try {
    ;(wa as Record<string, unknown>)[key] = wrapped
  } catch {
    // 全局冻结时忽略
  }
}

/** 基于追踪器构建扫描引擎所需的内存源。每次访问都读取最新的 buffer（防 detach） */
export function createMemoryProvider(tracker: WasmMemoryTracker): MemoryProvider {
  const byteLength = (record: TrackedMemoryRecord): number => {
    try {
      return record.memory.buffer.byteLength
    } catch {
      return 0
    }
  }
  return {
    listMemories(): MemoryInfo[] {
      return tracker.list().map((r) => ({ id: r.id, label: r.label, byteLength: byteLength(r) }))
    },
    getBuffer(memId: number): ArrayBuffer | null {
      const record = tracker.findById(memId)
      if (!record) return null
      try {
        const buffer = record.memory.buffer
        return buffer && buffer.byteLength > 0 ? buffer : null
      } catch {
        return null
      }
    }
  }
}
