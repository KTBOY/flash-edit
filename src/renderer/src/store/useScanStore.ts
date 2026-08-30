import { create } from 'zustand'
import type { ScanOp, ScanRequest, ScanSummary, ValueType } from '@shared/types'
import { AUTO_SCAN_TYPES, VALUE_TYPE_META } from '@shared/types'
import { scanEngine } from '@renderer/core/runtime'

export type TypeKey = 'auto' | ValueType

export interface ScanOptions {
  op: ScanOp
  typeKey: TypeKey
  valueText: string
  value2Text: string
  /** 浮点相对容差 */
  tolerance: number
}

const DEFAULT_OPTIONS: ScanOptions = {
  op: 'exact',
  typeKey: 'auto',
  valueText: '',
  value2Text: '',
  tolerance: 1e-6
}

interface ScanStore {
  options: ScanOptions
  scanning: boolean
  progress: number
  phaseLabel: string
  summary: ScanSummary | null
  hasSnapshot: boolean
  hasResults: boolean
  limitReached: boolean
  error: string | null
  resultsVersion: number
  page: number
  pageSize: number

  setOption(patch: Partial<ScanOptions>): void
  runScan(): Promise<void>
  undoScan(): void
  resetScan(): void
  bumpResults(): void
  setPage(page: number): void
  setError(message: string | null): void
}

/** "自动"类型展开为实际扫描类型集合 */
export function resolveScanTypes(typeKey: TypeKey): ValueType[] {
  return typeKey === 'auto' ? [...AUTO_SCAN_TYPES] : [typeKey]
}

/** 解析并校验扫描数值；非法输入返回 null */
export function parseScanValue(text: string, typeKey: TypeKey): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  if (typeKey !== 'auto' && VALUE_TYPE_META[typeKey].integer && !Number.isInteger(value)) {
    return null
  }
  return value
}

export const useScanStore = create<ScanStore>((set, get) => ({
  options: { ...DEFAULT_OPTIONS },
  scanning: false,
  progress: 0,
  phaseLabel: '',
  summary: null,
  hasSnapshot: false,
  hasResults: false,
  limitReached: false,
  error: null,
  resultsVersion: 0,
  page: 0,
  pageSize: 50,

  setOption: (patch) => set((s) => ({ options: { ...s.options, ...patch } })),
  setError: (message) => set({ error: message }),
  setPage: (page) => set({ page }),

  bumpResults: () =>
    set({
      resultsVersion: get().resultsVersion + 1,
      hasResults: scanEngine.hasResults,
      hasSnapshot: scanEngine.hasSnapshot,
      page: 0
    }),

  runScan: async () => {
    const { options, scanning } = get()
    if (scanning) return

    const { op, typeKey, valueText, value2Text, tolerance } = options
    const request: ScanRequest = { op, types: resolveScanTypes(typeKey), tolerance }

    if (op !== 'unknown' && op !== 'changed' && op !== 'unchanged' && op !== 'increased' && op !== 'decreased') {
      const value = parseScanValue(valueText, typeKey)
      if (value === null) {
        set({ error: '请输入有效的目标数值' })
        return
      }
      request.value = value
      if (op === 'between') {
        const value2 = parseScanValue(value2Text, typeKey)
        if (value2 === null || value2 < value) {
          set({ error: '请输入有效的区间上界（需不小于下界）' })
          return
        }
        request.value2 = value2
      }
    } else if ((op === 'increased' || op === 'decreased') && valueText.trim() !== '') {
      const delta = parseScanValue(valueText, typeKey)
      if (delta === null || delta <= 0) {
        set({ error: '变化量需为正数，或留空表示任意变化' })
        return
      }
      request.value = delta
    }

    const isFirst = !scanEngine.hasResults && !scanEngine.hasSnapshot
    set({ scanning: true, progress: 0, phaseLabel: '准备扫描', error: null })
    try {
      const summary = isFirst
        ? await scanEngine.firstScan(request, (p) => set({ progress: p.percent, phaseLabel: p.phase }))
        : await scanEngine.nextScan(request, (p) => set({ progress: p.percent, phaseLabel: p.phase }))
      set({
        scanning: false,
        summary,
        progress: 100,
        hasResults: scanEngine.hasResults,
        hasSnapshot: scanEngine.hasSnapshot,
        limitReached: summary.limitReached,
        resultsVersion: get().resultsVersion + 1,
        page: 0
      })
    } catch (error) {
      set({
        scanning: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  undoScan: () => {
    if (scanEngine.undo()) get().bumpResults()
  },

  resetScan: () => {
    scanEngine.reset()
    set({
      summary: null,
      hasSnapshot: false,
      hasResults: false,
      limitReached: false,
      progress: 0,
      phaseLabel: '',
      resultsVersion: get().resultsVersion + 1,
      page: 0
    })
  }
}))
