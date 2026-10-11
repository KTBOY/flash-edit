import type {
  AppInfo,
  AppSettings,
  CheatProfile,
  ExePackResult,
  ExeUnpackResult,
  GameRecord,
  GamesDeleteResult,
  DownloadSource,
  DownloadTask,
  SkillItem,
  SkillMarkdownResult,
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
  GAMES_RENAME: 'games:rename',
  GAMES_FS_CHANGED: 'games:fs-changed',
  PROFILES_LIST: 'profiles:list',
  PROFILES_LOAD: 'profiles:load',
  PROFILES_SAVE: 'profiles:save',
  PROFILES_DELETE: 'profiles:delete',
  SWF_PATCH_ANALYZE: 'swf:patch-analyze',
  SWF_PATCH_SAVE: 'swf:patch-save',
  EXE_PACK_SAVE: 'exe:pack-save',
  EXE_UNPACK_SAVE: 'exe:unpack-save',
  DOWNLOAD_SWF: 'download:swf',
  DOWNLOAD_SWF_CANCEL: 'download:swf-cancel',
  DOWNLOAD_SWF_LIST: 'download:swf-list',
  DOWNLOAD_SWF_REMOVE: 'download:swf-remove',
  DOWNLOAD_SWF_TASK: 'download:swf-task',
  DOWNLOAD_SHOW_FILE: 'download:show-file',
  SETTINGS_OPEN_DIR: 'settings:open-dir',
  SKILL_LIST: 'skill:list',
  SKILL_READ: 'skill:read',
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
  /**
   * 重命名游戏库记录的显示名（不改动磁盘文件名）。
   * 名字去掉首尾空白后须非空；记录不存在或名字非法返回 false。
   */
  renameGame(hash: string, name: string): Promise<boolean>
  /**
   * 订阅下载目录文件变化事件（主进程 fs.watch 防抖后推送）。
   * 外部增删/移动游戏文件后渲染层据此刷新游戏库列表，返回取消订阅函数。
   */
  onGamesChanged(callback: () => void): () => void
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
   * 提交指定来源的下载任务。来源由调用方（下载面板的站点入口）给定，
   * 主进程据此选 provider：oldswf 驱动本机真实浏览器绕 TLS 指纹反爬，
   * gamebox 直接带 Referer 取对象存储直链。
   * 多任务并发，超出并发上限自动排队；立即返回任务快照，进度经事件通道推送。
   * 同一来源的同一游戏 ID 正在下载或排队时拒绝。
   */
  startDownload(source: DownloadSource, input: string): Promise<DownloadTask>
  /** 取消指定任务（关闭其浏览器会话/中断请求）；无对应进行中任务返回 false */
  cancelDownload(taskId: string): Promise<boolean>
  /** 全部下载任务（含已结束），供渲染层初始化同步 */
  listDownloads(): Promise<DownloadTask[]>
  /**
   * 按任务标识批量移除下载任务记录（仅清列表，不删游戏库记录与磁盘文件）。
   * 仍在排队或下载中的任务会先取消。
   */
  removeDownloads(taskIds: string[]): Promise<void>
  /** 订阅下载任务状态与进度变化，返回取消订阅函数 */
  onDownloadTask(callback: (task: DownloadTask) => void): () => void
  /** 在系统文件管理器中显示文件 */
  showFileInFolder(path: string): void
  /**
   * 扫描本地 Agent Skill（项目 / 用户全局 / 插件内置三类来源）。
   * 结果已按来源与名称排序，并标出跨来源重名的条目。
   */
  listSkills(): Promise<SkillItem[]>
  /**
   * 读取指定 SKILL.md 正文（去掉 frontmatter）。
   * 主进程只允许读取位于扫描根内的文件，越界或读不到返回 null。
   */
  readSkillMarkdown(path: string): Promise<SkillMarkdownResult | null>
  /** 读取应用设置（含生效的下载保存目录） */
  getSettings(): Promise<AppSettings>
  /** 弹出目录选择框修改下载保存目录；取消返回 null，选中则持久化并返回新设置 */
  chooseDownloadDir(): Promise<AppSettings | null>
  /**
   * 在系统文件管理器中打开当前生效的下载目录（目录路径只取自主进程设置）。
   * 成功返回空串，失败返回系统给出的原因。
   */
  openDownloadFolder(): Promise<string>
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
