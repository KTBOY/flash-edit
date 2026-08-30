import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { CheatEntry, CheatProfile } from '@shared/types'
import { formatAddress } from '@renderer/core/scan/engine'
import { freezeManager, scanEngine } from '@renderer/core/runtime'
import { useGameStore } from './useGameStore'

interface CheatStore {
  entries: CheatEntry[]
  /** 当前配置归属的游戏（未加载游戏时为 null，禁止添加条目） */
  gameHash: string | null
  gameName: string

  switchGame(hash: string, name: string): void
  /** 将扫描结果序号加入修改列表，desc 为空时自动命名 */
  addFromResult(resultIndex: number, desc?: string): CheatEntry | null
  updateValue(id: string, value: number): void
  updateDesc(id: string, desc: string): void
  toggleLock(id: string): void
  remove(id: string): void
  clear(): void
  /** 恢复存档配置；对每条做地址有效性校验，读不到的标记为 stale */
  applyProfile(profile: CheatProfile): { restored: number; stale: number }
  markStaleness(): void
  buildProfile(): CheatProfile | null
}

function commit(entries: CheatEntry[]): void {
  // 冻结引擎以本列表为唯一事实来源
  freezeManager.sync(entries)
}

export const useCheatStore = create<CheatStore>((set, get) => ({
  entries: [],
  gameHash: null,
  gameName: '',

  switchGame: (hash, name) => {
    commit([])
    set({ entries: [], gameHash: hash, gameName: name })
  },

  addFromResult: (resultIndex, desc) => {
    const { gameHash } = get()
    if (!gameHash) return null
    const candidate = scanEngine.getCandidateAt(resultIndex)
    if (!candidate) return null
    const value = scanEngine.readValue(candidate.memId, candidate.offset, candidate.type) ?? 0
    const entry: CheatEntry = {
      id: nanoid(8),
      desc: desc?.trim() || `地址 ${formatAddress(candidate.memId, candidate.offset)}`,
      memId: candidate.memId,
      offset: candidate.offset,
      type: candidate.type,
      value,
      locked: false,
      stale: false,
      originalValue: value
    }
    const entries = [...get().entries, entry]
    commit(entries)
    set({ entries })
    return entry
  },

  updateValue: (id, value) => {
    const entries = get().entries.map((entry) => {
      if (entry.id !== id) return entry
      // 首次改动时把改前值固化为 originalValue（SWF 常量补丁的定位依据）
      const originalValue = entry.originalValue ?? entry.value
      return { ...entry, value, originalValue }
    })
    commit(entries)
    set({ entries })
  },

  updateDesc: (id, desc) => {
    set({ entries: get().entries.map((entry) => (entry.id === id ? { ...entry, desc } : entry)) })
  },

  toggleLock: (id) => {
    const entries = get().entries.map((entry) =>
      entry.id === id ? { ...entry, locked: !entry.locked, stale: false } : entry
    )
    commit(entries)
    set({ entries })
  },

  remove: (id) => {
    const entries = get().entries.filter((entry) => entry.id !== id)
    commit(entries)
    set({ entries })
  },

  clear: () => {
    commit([])
    set({ entries: [] })
  },

  applyProfile: (profile) => {
    const entries = profile.entries.map<CheatEntry>((entry) => {
      const readable =
        scanEngine.readValue(entry.memId, entry.offset, entry.type) !== null
      return { ...entry, locked: false, stale: !readable }
    })
    commit(entries)
    set({ entries, gameHash: profile.gameHash, gameName: profile.gameName })
    return {
      restored: entries.length,
      stale: entries.filter((entry) => entry.stale).length
    }
  },

  markStaleness: () => {
    const entries = get().entries.map((entry) => ({
      ...entry,
      stale: scanEngine.readValue(entry.memId, entry.offset, entry.type) === null
    }))
    set({ entries })
  },

  buildProfile: () => {
    const { gameHash, gameName, entries } = get()
    if (!gameHash) return null
    return {
      version: 1,
      gameHash,
      gameName,
      entries,
      speed: useGameStore.getState().speed,
      updatedAt: new Date().toISOString()
    }
  }
}))
