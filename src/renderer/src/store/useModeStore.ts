import { create } from 'zustand'

/**
 * 打包模式 / 侧边栏状态。
 *
 * 「打包模式」= 分发给普通用户的精简形态：隐藏下载入口与专家级面板
 * （数值扫描 / 修改列表）。输入密令后永久解锁为完整模式。
 *
 * 说明：密令只是防误触的软开关，不具备任何安全强度，因此校验放在渲染层，
 * 不值得为此扩大 IPC 攻击面。localStorage 不可用时一律降级回打包模式。
 */

const STORAGE_KEY = 'fgt.mode.v1'

/** 密令不写成明文，仅避免全局搜索一击命中；不做任何安全承诺 */
const UNLOCK_CODE = ['te', 'st'].join('')

export const SIDER_WIDTH = 470

interface PersistedMode {
  fullMode?: boolean
  siderOpen?: boolean
}

interface ModeStore {
  /** true = 完整模式（已解锁）；false = 打包模式（精简，默认） */
  fullMode: boolean
  /** 右侧侧边栏是否展开（默认收起） */
  siderOpen: boolean
  /** 校验密令，成功则永久解锁 */
  unlock(code: string): boolean
  setSiderOpen(open: boolean): void
  toggleSider(): void
}

function readPersisted(): PersistedMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PersistedMode
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writePersisted(state: Pick<ModeStore, 'fullMode' | 'siderOpen'>): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ fullMode: state.fullMode, siderOpen: state.siderOpen })
    )
  } catch {
    // 存储被禁用/写满：功能仍可用，只是下次启动回到打包模式
  }
}

const persisted = readPersisted()

export const useModeStore = create<ModeStore>((set, get) => ({
  fullMode: persisted.fullMode === true,
  siderOpen: persisted.siderOpen === true,

  unlock: (code) => {
    if (code.trim().toLowerCase() !== UNLOCK_CODE) return false
    if (get().fullMode) return true
    set({ fullMode: true })
    writePersisted({ fullMode: true, siderOpen: get().siderOpen })
    return true
  },

  setSiderOpen: (open) => {
    if (get().siderOpen === open) return
    set({ siderOpen: open })
    writePersisted({ fullMode: get().fullMode, siderOpen: open })
  },

  toggleSider: () => get().setSiderOpen(!get().siderOpen)
}))
