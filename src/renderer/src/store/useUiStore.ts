import { create } from 'zustand'

/**
 * 侧边栏展开状态。
 * localStorage 不可用时回落到默认展开，不影响功能。
 */

const STORAGE_KEY = 'fgt.ui.v1'

/** 侧边栏固定宽度（px） */
export const SIDER_WIDTH = 470

interface UiStore {
  /** 右侧功能面板是否展开（默认展开：游戏库与网络下载都在这里） */
  siderOpen: boolean
  setSiderOpen(open: boolean): void
  toggleSider(): void
}

/** 未持久化过时按展开处理，只有用户手动收起过才记住收起 */
function readPersistedSider(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return true
    return (JSON.parse(raw) as { siderOpen?: boolean }).siderOpen !== false
  } catch {
    return true
  }
}

function persistSider(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ siderOpen: open }))
  } catch {
    // 存储被禁用/写满：功能仍可用，只是下次启动回到默认收起
  }
}

export const useUiStore = create<UiStore>((set, get) => ({
  siderOpen: readPersistedSider(),

  setSiderOpen: (open) => {
    if (get().siderOpen === open) return
    set({ siderOpen: open })
    persistSider(open)
  },

  toggleSider: () => get().setSiderOpen(!get().siderOpen)
}))
