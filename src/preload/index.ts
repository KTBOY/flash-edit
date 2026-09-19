import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CheatProfile,
  ExePackResult,
  GameRecord,
  OldswfDownloadTask,
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
  removeGames: (hashes: string[], deleteFiles: boolean) =>
    ipcRenderer.invoke(IPC.GAMES_DELETE, hashes, deleteFiles),
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
  unpackSwfFromExe: () => ipcRenderer.invoke(IPC.EXE_UNPACK_SAVE),

  startOldswfDownload: (input: string) => ipcRenderer.invoke(IPC.DOWNLOAD_OLDSWF, input),
  cancelOldswfDownload: (gameId: string) => ipcRenderer.invoke(IPC.DOWNLOAD_OLDSWF_CANCEL, gameId),
  listOldswfDownloads: () => ipcRenderer.invoke(IPC.DOWNLOAD_OLDSWF_LIST),
  removeOldswfDownloads: (gameIds: string[]) =>
    ipcRenderer.invoke(IPC.DOWNLOAD_OLDSWF_REMOVE, gameIds),
  onOldswfDownloadTask: (callback: (task: OldswfDownloadTask) => void) => {
    const listener = (_event: IpcRendererEvent, task: OldswfDownloadTask) => callback(task)
    ipcRenderer.on(IPC.DOWNLOAD_OLDSWF_TASK, listener)
    return () => {
      ipcRenderer.removeListener(IPC.DOWNLOAD_OLDSWF_TASK, listener)
    }
  },
  showFileInFolder: (path: string) => ipcRenderer.send(IPC.DOWNLOAD_SHOW_FILE, path),

  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  chooseDownloadDir: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_DIR),

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
  },

  openExternal: (url: string) => ipcRenderer.send(IPC.SHELL_OPEN_EXTERNAL, url)
}

contextBridge.exposeInMainWorld(IPC_BRIDGE_KEY, api)
