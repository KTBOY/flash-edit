import { create } from 'zustand'
import type { SkillItem } from '@shared/types'
import { getApi } from '@renderer/services/ipc.service'

/**
 * 本地 Skill 列表缓存。
 *
 * 磁盘是唯一事实来源，这里只缓存一次扫描的结果：面板首次挂载拉取，
 * 之后只有用户点「刷新」才重扫，避免每次切回 Tab 都读几十个文件。
 */
interface SkillStore {
  items: SkillItem[]
  loading: boolean
  loaded: boolean
  failed: boolean
  refresh(): Promise<void>
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  failed: false,

  refresh: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      set({ items: await getApi().listSkills(), loaded: true, failed: false })
    } catch {
      set({ failed: true })
    } finally {
      set({ loading: false })
    }
  }
}))
