import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CheatProfile,
  ExePackResult,
  GameRecord,
  SwfPatchReportItem,
  SwfPatchSpec,
  SwfSaveResult
} from '@shared/types'
import { IPC, IPC_BRIDGE_KEY, type IpcApi } from '@shared/ipc'

/**
 * preload：仅暴露白名单化的 IPC 封装，不传递任意 channel。
 * 实现共享契约 IpcApi，renderer 通过 window.api 类型安全调用。
 */
const api: IpcApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.APP_INFO),
  pickSwfFile: () => ipcRenderer.invoke(IPC.DIALOG_PICK_SWF),
  listRecentGames: () => ipcRenderer.invoke(IPC.GAMES_LIST),
  addRecentGame: (record: GameRecord) => ipcRenderer.invoke(IPC.GAMES_ADD, record),
  removeRecentGame: (hash: string) => ipcRenderer.invoke(IPC.GAMES_REMOVE, hash),
  listProfiles: () => ipcRenderer.invoke(IPC.PROFILES_LIST),
  loadProfile: (gameHash: string) => ipcRenderer.invoke(IPC.PROFILES_LOAD, gameHash),
  saveProfile: (profile: CheatProfile) => ipcRenderer.invoke(IPC.PROFILES_SAVE, profile),
  deleteProfile: (gameHash: string) => ipcRenderer.invoke(IPC.PROFILES_DELETE, gameHash),

  analyzeSwfPatch: (bytes: Uint8Array, specs: SwfPatchSpec[]): Promise<SwfPatchReportItem[]> =>
    ipcRenderer.invoke(IPC.SWF_PATCH_ANALYZE, bytes, specs),
  savePatchedSwf: (
    bytes: Uint8Array,
    specs: SwfPatchSpec[],
    defaultName: string
  ): Promise<SwfSaveResult> => ipcRenderer.invoke(IPC.SWF_PATCH_SAVE, bytes, specs, defaultName),
  packSwfExe: (
    swfBytes: Uint8Array,
    defaultName: string,
    customProjector?: Uint8Array
  ): Promise<ExePackResult> =>
    ipcRenderer.invoke(IPC.EXE_PACK_SAVE, swfBytes, defaultName, customProjector),

  minimizeWindow: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  toggleMaximizeWindow: () => ipcRenderer.send(IPC.WINDOW_TOGGLE_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
  isWindowMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
  onWindowMaximized: (callback) => {
    const listener = (_event: IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on(IPC.WINDOW_MAXIMIZED_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC.WINDOW_MAXIMIZED_EVENT, listener)
    }
  }
}

contextBridge.exposeInMainWorld(IPC_BRIDGE_KEY, api)
