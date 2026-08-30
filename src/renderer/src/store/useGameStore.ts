import { create } from 'zustand'
import type { AppInfo, GameRecord } from '@shared/types'
import { getApi } from '@renderer/services/ipc.service'

export interface CurrentGame {
  hash: string
  name: string
  size: number
  source: 'file' | 'drop' | 'url'
}

export type GamePhase = 'idle' | 'loading' | 'ready' | 'error'

interface GameStore {
  phase: GamePhase
  game: CurrentGame | null
  error: string | null
  recent: GameRecord[]
  speed: number
  appInfo: AppInfo | null

  beginLoad(): void
  completeLoad(game: CurrentGame): void
  failLoad(message: string): void
  clearGame(): void
  setSpeed(speed: number): void
  setAppInfo(info: AppInfo): void
  refreshRecent(): Promise<void>
  init(): Promise<void>
}

export const useGameStore = create<GameStore>((set) => ({
  phase: 'idle',
  game: null,
  error: null,
  recent: [],
  speed: 1,
  appInfo: null,

  beginLoad: () => set({ phase: 'loading', error: null }),
  completeLoad: (game) => set({ phase: 'ready', game, error: null }),
  failLoad: (message) => set({ phase: 'error', error: message }),
  clearGame: () => set({ phase: 'idle', game: null, error: null }),
  setSpeed: (speed) => set({ speed }),
  setAppInfo: (info) => set({ appInfo: info }),

  refreshRecent: async () => {
    try {
      const recent = await getApi().listRecentGames()
      set({ recent })
    } catch {
      // IPC 未就绪时静默，UI 显示空列表
    }
  },

  init: async () => {
    const store = useGameStore.getState()
    try {
      store.setAppInfo(await getApi().getAppInfo())
    } catch {
      // 忽略：appInfo 仅展示用
    }
    await store.refreshRecent()
  }
}))
