import type {
  AppInfo,
  AppSettings,
  CheatProfile,
  ExePackResult,
  ExeUnpackResult,
  GameRecord,
  GamesDeleteResult,
  OldswfDownloadTask,
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
  GAMES_DELETE: 'games:delete',
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
  DOWNLOAD_OLDSWF_LIST: 'download:oldswf-list',
  DOWNLOAD_OLDSWF_REMOVE: 'download:oldswf-remove',
  DOWNLOAD_OLDSWF_TASK: 'download:oldswf-task',
  DOWNLOAD_SHOW_FILE: 'download:show-file',
  SETTINGS_GET: 'settings:get',
  SETTINGS_PICK_DIR: 'settings:pick-dir',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_MAXIMIZED_EVENT: 'window:maximized-changed',
  SHELL_OPEN_EXTERNAL: 'shell:open-external'
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
  /**
   * 批量移除游戏库记录。
   * deleteFiles 为 true 时同时删除磁盘文件，但仅限位于下载目录内的文件——
   * 目录外的原始文件只移除记录，避免误删用户自己电脑上的其它 SWF。
   */
  removeGames(hashes: string[], deleteFiles: boolean): Promise<GamesDeleteResult>
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
   * 提交 oldswf 下载任务（驱动本机真实浏览器监听分片，绕过 TLS 指纹反爬）。
   * 多任务并发，超出并发上限自动排队；立即返回任务快照，进度经事件通道推送。
   * 同一游戏 ID 正在下载或排队时拒绝。
   */
  startOldswfDownload(input: string): Promise<OldswfDownloadTask>
  /** 取消指定游戏 ID 的下载（关闭其浏览器会话）；无对应进行中任务返回 false */
  cancelOldswfDownload(gameId: string): Promise<boolean>
  /** 全部下载任务（含已结束），供渲染层初始化同步 */
  listOldswfDownloads(): Promise<OldswfDownloadTask[]>
  /**
   * 按游戏 ID 批量移除下载任务记录（仅清列表，不删游戏库记录与磁盘文件）。
   * 仍在排队或下载中的任务会先取消。
   */
  removeOldswfDownloads(gameIds: string[]): Promise<void>
  /** 订阅下载任务状态与进度变化，返回取消订阅函数 */
  onOldswfDownloadTask(callback: (task: OldswfDownloadTask) => void): () => void
  /** 在系统文件管理器中显示文件 */
  showFileInFolder(path: string): void
  /** 读取应用设置（含生效的下载保存目录） */
  getSettings(): Promise<AppSettings>
  /** 弹出目录选择框修改下载保存目录；取消返回 null，选中则持久化并返回新设置 */
  chooseDownloadDir(): Promise<AppSettings | null>
  /* 无边框窗口控制（自定义标题栏） */
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
  isWindowMaximized(): Promise<boolean>
  /** 订阅最大化状态变化，返回取消订阅函数 */
  onWindowMaximized(callback: (maximized: boolean) => void): () => void
  /**
   * 用系统默认浏览器打开外部链接。
   * 主进程侧强制 http/https 白名单，非白名单协议会被静默丢弃。
   */
  openExternal(url: string): void
}

/** preload 注入到 window 的全局键名 */
export const IPC_BRIDGE_KEY = 'api'
