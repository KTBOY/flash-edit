import { describe, expect, it } from 'vitest'
import { WasmMemoryTracker, createMemoryProvider } from '../tracker'

/** (module (memory 1) (export "mem" (memory 0))) 的最小 wasm 模块 */
const MEM_MODULE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x07, 0x01, 0x03, 0x6d, 0x65, 0x6d, 0x02, 0x00
])

/** 构造隔离的 WebAssembly 宿主对象，避免污染测试进程真实全局 */
function createIsolatedHost(): { WebAssembly: typeof WebAssembly } {
  return {
    WebAssembly: {
      Memory: WebAssembly.Memory,
      Instance: WebAssembly.Instance,
      Module: WebAssembly.Module,
      instantiate: WebAssembly.instantiate,
      instantiateStreaming: WebAssembly.instantiateStreaming,
      compile: WebAssembly.compile,
      compileStreaming: WebAssembly.compileStreaming,
      validate: WebAssembly.validate,
      Global: WebAssembly.Global,
      Table: WebAssembly.Table
    } as unknown as typeof WebAssembly
  }
}

describe('WasmMemoryTracker', () => {
  it('捕获通过构造器创建的 Memory', () => {
    const tracker = new WasmMemoryTracker()
    const host = createIsolatedHost()
    tracker.install(host)

    expect(tracker.count).toBe(0)
    const memory = new host.WebAssembly.Memory({ initial: 1 })
    expect(tracker.count).toBe(1)
    expect(memory instanceof WebAssembly.Memory).toBe(true)

    const provider = createMemoryProvider(tracker)
    expect(provider.listMemories()[0].byteLength).toBe(65536)
  })

  it('去重：同一 Memory 只登记一次', () => {
    const tracker = new WasmMemoryTracker()
    const host = createIsolatedHost()
    tracker.install(host)

    // 模块内部导出的 memory 通过 Instance 扫描登记，与构造器捕获去重
    const memory = new host.WebAssembly.Memory({ initial: 1 })
    tracker.install(host) // 幂等
    expect(tracker.count).toBe(1)
    expect(memory).toBeDefined()
  })

  it('grow 后 provider 读取到最新长度', async () => {
    const tracker = new WasmMemoryTracker()
    const host = createIsolatedHost()
    tracker.install(host)

    const memory = new host.WebAssembly.Memory({ initial: 1 })
    const provider = createMemoryProvider(tracker)
    expect(provider.listMemories()[0].byteLength).toBe(65536)

    memory.grow(1)
    expect(provider.listMemories()[0].byteLength).toBe(131072)
    const buffer = provider.getBuffer(0)
    expect(buffer).not.toBeNull()
    expect(buffer!.byteLength).toBe(131072)
  })

  it('通过 instantiate 捕获模块导出的 memory', async () => {
    const tracker = new WasmMemoryTracker()
    const host = createIsolatedHost()
    tracker.install(host)

    await host.WebAssembly.instantiate(MEM_MODULE_BYTES)
    expect(tracker.count).toBe(1)
    expect(tracker.list()[0].memory.buffer.byteLength).toBe(65536)
  })

  it('未安装补丁时不捕获', () => {
    const tracker = new WasmMemoryTracker()
    void new WebAssembly.Memory({ initial: 1 })
    expect(tracker.count).toBe(0)
  })
})
