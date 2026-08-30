import type {
  AppInfo,
  CheatProfile,
  ExePackResult,
  ExeUnpackResult,
  GameRecord,
  OldswfDownloadProgress,
  OldswfDownloadResult,
  SwfPatchReportItem,
  SwfPatchSpec,
  SwfPickResult,
  SwfSaveResult
} from './types'

/**
 * IPC 通道常量。渲染进程与主进程共同引用，避免魔法字符串。
 */
export const IPC = {
  APP_INFO: 'app:info',
  DIALOG_PICK_SWF: 'dialog:pick-swf',
  GAMES_LIST: 'games:list',
  GAMES_ADD: 'games:add',
  GAMES_REMOVE: 'games:remove',
  PROFILES_LIST: 'profiles:list',
  PROFILES_LOAD: 'profiles:load',
  PROFILES_SAVE: 'profiles:save',
  PROFILES_DELETE: 'profiles:delete',
  SWF_PATCH_ANALYZE: 'swf:patch-analyze',
  SWF_PATCH_SAVE: 'swf:patch-save',
  EXE_PACK_SAVE: 'exe:pack-save',
  EXE_UNPACK_SAVE: 'exe:unpack-save',
  DOWNLOAD_OLDSWF: 'download:oldswf',
  DOWNLOAD_OLDSWF_CANCEL: 'download:oldswf-cancel',
  DOWNLOAD_OLDSWF_PROGRESS: 'download:oldswf-progress',
  DOWNLOAD_SHOW_FILE: 'download:show-file',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_MAXIMIZED_EVENT: 'window:maximized-changed'
} as const

/**
 * 渲染进程可用 API（preload 通过 contextBridge 暴露）。
 * 该接口是唯一的跨进程契约：preload 实现它，renderer 只依赖它。
 */
export interface IpcApi {
  getAppInfo(): Promise<AppInfo>
  /** 打开系统文件选择框选择 SWF，取消返回 null */
  pickSwfFile(): Promise<SwfPickResult | null>
  listRecentGames(): Promise<GameRecord[]>
  addRecentGame(record: GameRecord): Promise<void>
  removeRecentGame(hash: string): Promise<void>
  listProfiles(): Promise<string[]>
  loadProfile(gameHash: string): Promise<CheatProfile | null>
  saveProfile(profile: CheatProfile): Promise<void>
  deleteProfile(gameHash: string): Promise<void>
  /** 干跑：分析补丁命中数，不写盘 */
  analyzeSwfPatch(bytes: Uint8Array, specs: SwfPatchSpec[]): Promise<SwfPatchReportItem[]>
  /** 弹出另存对话框，应用补丁并写出新 SWF */
  savePatchedSwf(
    bytes: Uint8Array,
    specs: SwfPatchSpec[],
    defaultName: string
  ): Promise<SwfSaveResult>
  /** SWF 打包为独立 EXE：附加到 Flash projector 末尾并另存；customProjector 缺省用内置播放器 */
  packSwfExe(
    swfBytes: Uint8Array,
    defaultName: string,
    customProjector?: Uint8Array
  ): Promise<ExePackResult>
  /** EXE 还原为 SWF：选 projector 封装的 EXE，按尾部页脚定位附加 SWF 并另存 */
  unpackSwfFromExe(): Promise<ExeUnpackResult>
  /**
   * 从 oldswf.com 下载游戏 SWF（驱动本机真实浏览器监听分片，绕过 TLS 指纹反爬）。
   * 单并发：进行中再次调用直接拒绝；完成后文件落在 userData/games 并自动入游戏库。
   */
  downloadOldswfGame(input: string): Promise<OldswfDownloadResult>
  /** 取消进行中的 oldswf 下载（关闭浏览器会话）；无进行中任务返回 false */
  cancelOldswfDownload(): Promise<boolean>
  /** 订阅 oldswf 下载进度，返回取消订阅函数 */
  onOldswfDownloadProgress(callback: (progress: OldswfDownloadProgress) => void): () => void
  /** 在系统文件管理器中显示文件 */
  showFileInFolder(path: string): void
  /* 无边框窗口控制（自定义标题栏） */
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  isWindowMaximized(): Promise<boolean>
  /** 订阅最大化状态变化，返回取消订阅函数 */
  onWindowMaximized(callback: (maximized: boolean) => void): () => void
}

/** preload 注入到 window 的全局键名 */
export const IPC_BRIDGE_KEY = 'api'
