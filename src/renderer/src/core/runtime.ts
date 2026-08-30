import { ScanEngine } from './scan/engine'
import { FreezeManager } from './scan/freeze'
import { TimeScaler } from './wasm/time-scaler'
import { WasmMemoryTracker, createMemoryProvider } from './wasm/tracker'

/**
 * 渲染层运行时单例。
 *
 * 本模块必须在任何其他业务模块之前导入：
 * 1. TimeScaler.install() 在 Ruffle 加载前包装时间函数（变速）；
 * 2. WasmMemoryTracker.install() 在 Ruffle 加载前捕获 WASM 内存（扫描前提）。
 * Ruffle 采用按需加载，因此只要本模块被入口引用，时序即得到保证。
 */

export const timeScaler = new TimeScaler()
timeScaler.install()

export const realNow = (): number => timeScaler.realNow()

export const memoryTracker = new WasmMemoryTracker()
memoryTracker.install()

export const memoryProvider = createMemoryProvider(memoryTracker)

export const scanEngine = new ScanEngine(memoryProvider, { nowFn: realNow })

export const freezeManager = new FreezeManager({
  writeAt: (memId, offset, type, value) => scanEngine.writeAt(memId, offset, type, value)
})
