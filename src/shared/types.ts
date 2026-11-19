/**
 * 全局共享类型：主进程 / 预加载 / 渲染进程唯一事实来源。
 * 任何跨进程的数据结构都必须在这里定义，禁止各层私自重复声明。
 */

/** 内存数值类型。AVM(Number) 为 IEEE754 双精度，Rust 侧常见 i32/f32。 */
export type ValueType = 'f64' | 'f32' | 'i32' | 'i16' | 'i8'

/** 扫描比较方式（对齐 Cheat Engine 语义） */
export type ScanOp =
  | 'exact' // 精确值
  | 'between' // 介于 min ~ max
  | 'unknown' // 未知初始值（做全量快照）
  | 'increased' // 增大（可选：恰好增大 delta）
  | 'decreased' // 减小（可选：恰好减小 delta）
  | 'changed' // 变动了
  | 'unchanged' // 未变动

/** 扫描请求 */
export interface ScanRequest {
  op: ScanOp
  /** 主值（exact/ increased delta 等） */
  value?: number
  /** between 的上界 */
  value2?: number
  /** 参与扫描的值类型集合 */
  types: ValueType[]
  /** 浮点比较容差（相对误差） */
  tolerance: number
}

/** 一次扫描的统计摘要 */
export interface ScanSummary {
  /** 命中的候选地址数 */
  total: number
  /** 参与扫描的内存块数 */
  scannedMemories: number
  /** 扫描的字节总量 */
  scannedBytes: number
  /** 耗时（毫秒） */
  durationMs: number
  /** 因候选数超出上限而提前终止 */
  limitReached: boolean
}

/** 扫描结果行（供表格展示） */
export interface ScanResultRow {
  /** 候选在结果集中的全局序号 */
  index: number
  memId: number
  /** 展示用地址：M{memId}:0xXXXXXXXX */
  address: string
  type: ValueType
  value: number
}

/** 修改条目（cheat table 的一行） */
export interface CheatEntry {
  id: string
  /** 用户可读名称，例如 "金币" */
  desc: string
  memId: number
  /** 内存块内字节偏移 */
  offset: number
  type: ValueType
  value: number
  /** 是否锁定（冻结） */
  locked: boolean
  /** 读取校验失败（重开游戏后地址可能失效） */
  stale: boolean
  /** 进入修改列表时（或首次改动前）的数值，用于 SWF 常量补丁定位原值 */
  originalValue?: number
}

/**
 * SWF 常量补丁规格：把文件内等于 original 的常量改写为 value。
 * kind 表示按哪种二进制形态匹配（f64/f32 为浮点字节，i32 为 ABC 整数池）。
 */
export interface SwfPatchSpec {
  id: string
  desc: string
  kind: 'f64' | 'f32' | 'i32'
  original: number
  value: number
}

/** 单条补丁的应用报告 */
export interface SwfPatchReportItem {
  id: string
  desc: string
  /** 成功改写的常量个数 */
  sites: number
  /** 因变长编码长度不一致而跳过的个数 */
  skipped: number
}

/** 保存补丁后 SWF 的结果 */
export interface SwfSaveResult {
  canceled: boolean
  path?: string
  report: SwfPatchReportItem[]
}

/** SWF 打包为独立 EXE 的结果 */
export interface ExePackResult {
  canceled: boolean
  path?: string
  /** 生成的 EXE 字节数 */
  exeSize: number
  /** 所用 projector 字节数 */
  projectorSize: number
}

/** EXE 还原（提取附加 SWF）的结果 */
export interface ExeUnpackResult {
  /** pick-canceled 未选择 EXE / save-canceled 取消另存 / not-found 无附加 SWF / saved 成功 */
  status: 'pick-canceled' | 'save-canceled' | 'not-found' | 'saved'
  /** 提取出的 SWF 保存路径（saved 时存在） */
  path?: string
  /** 保存的文件名（含扩展名，saved 时存在） */
  name?: string
  /** 附加 SWF 的字节数 */
  swfSize?: number
  /** EXE 中 projector 部分的字节数 */
  projectorSize?: number
  /** SWF 文件头标识 */
  magic?: 'FWS' | 'CWS' | 'ZWS'
}

/** 按游戏哈希持久化的修改配置 */
export interface CheatProfile {
  version: 1
  gameHash: string
  gameName: string
  entries: CheatEntry[]
  /** 变速倍率 */
  speed: number
  updatedAt: string
}

/** 游戏库记录 */
export interface GameRecord {
  /** SWF 内容 sha256，或 URL 场景下的 "url:<sha256(url)>" */
  hash: string
  name: string
  size: number
  lastPlayed: string
  source: 'file' | 'drop' | 'url' | 'download'
  /** 本地文件绝对路径（drop 场景拿不到） */
  path?: string
  url?: string
  /** 磁盘文件已不存在（games:list 返回时按 path 实时标注，不持久化） */
  missing?: boolean
}

/**
 * 游戏库批量删除结果。
 * 记录一律移除；文件只在位于下载目录内时才删，目录外的原始文件保留（keptFiles）。
 */
export interface GamesDeleteResult {
  /** 已从磁盘删除的文件绝对路径 */
  deletedFiles: string[]
  /** 因不在下载目录内而保留的文件绝对路径（仅移除了记录） */
  keptFiles: string[]
  /** 删除失败的文件绝对路径（文件被占用 / 权限不足等） */
  failedFiles: string[]
}

/**
 * 下载来源站点。每个来源对应主进程一个 provider（输入格式、取源方式、反爬手段各不同），
 * 共用同一套队列、进度与落盘逻辑。新增站点只需实现 provider 并加入注册表。
 */
export type DownloadSource = 'oldswf' | 'gamebox'

/** 下载阶段：starting 取源准备 / downloading 下载资源 / extracting 兜底提取 / saving 落盘 */
export type DownloadPhase = 'starting' | 'downloading' | 'extracting' | 'saving'

/** 下载任务状态（queued 表示等待并发额度） */
export type DownloadTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

/**
 * 下载任务快照（主进程 → 渲染进程）。
 * 状态与进度合一：主进程是任务列表唯一事实来源，渲染层只做展示与操作。
 */
export interface DownloadTask {
  /** 任务标识，形如 `oldswf:109087`——不同站点的游戏 ID 会重号，必须带来源 */
  id: string
  source: DownloadSource
  /** 站点内的游戏 ID */
  gameId: string
  /** 用户原始输入（游戏页地址或 ID），重试时复用 */
  input: string
  status: DownloadTaskStatus
  /** 当前（或最后）阶段；queued 时为 null */
  phase: DownloadPhase | null
  /** 已接收字节数（去重分片求和） */
  receivedBytes: number
  /** 总字节数；0 表示尚不可知 */
  totalBytes: number
  /** 已捕获分片数 */
  chunkCount: number
  /** 成功后的落盘信息 */
  result: DownloadResult | null
  /** 失败原因（status 为 failed 时存在） */
  error: string | null
  /** 任务创建时间戳，用于列表排序 */
  createdAt: number
}

/** 应用设置（持久化到 userData/data/settings.json） */
export interface AppSettings {
  /** 网络下载游戏的保存目录（生效值，未自定义时为主进程回填的默认目录） */
  downloadDir: string
}

/** 下载结果（站点无关；name/path 由主进程按「清洗后标题_游戏ID.swf」命名） */
export interface DownloadResult {
  source: DownloadSource
  gameId: string
  /** 保存的文件名（含扩展名），与游戏库记录 name 一致 */
  name: string
  /** 下载目录下的绝对路径 */
  path: string
  sizeBytes: number
}

/** 文件选择结果 */
export interface SwfPickResult {
  path: string
  name: string
  size: number
}

/** 工具箱：快捷方式 bat 的生成模式 */
export type ShortcutBatMode =
  /** bat 与目标 EXE 同目录：目标路径用 %~dp0 运行时展开，文件夹整体移动/分发后依然有效 */
  | 'portable'
  /** bat 与 EXE 分离：内嵌 EXE 绝对路径，仅在本机当前位置有效 */
  | 'absolute'

/** 工具箱：生成「双击创建桌面快捷方式」bat 的结果 */
export interface ShortcutBatResult {
  batPath: string
  targetPath: string
  mode: ShortcutBatMode
}

/** 工具箱：一键解压安装 bat 的生成结果 */
export interface SfxInstallBatResult {
  /** 生成的 bat 绝对路径（一键解压安装.bat） */
  batPath: string
  /** 解压目标目录（SFX 同目录同名文件夹），bat 运行时把游戏解压到这里 */
  targetDir: string
  /** 启动器在解压目标内的相对路径，快捷方式与打开游戏都指向它 */
  launcherRelPath: string
  /** bat 与 SFX 同目录 → portable（整包可移动分发）；否则 absolute（仅本机当前位置有效） */
  mode: ShortcutBatMode
}

/* ---------- 工具箱：网页资源下载（图片 / 视频） ---------- */

/** 网页资源类型：image 图片 / video 直链视频 / embed 嵌入播放器（无直链）/ file 其他直链文件 */
export type WebResourceKind = 'image' | 'video' | 'embed' | 'file'

/** 站点解析方式：auto 按域名自动识别 / gameshare 精确解析 / generic 任意网页兜底 */
export type WebResourceSiteId = 'auto' | 'gameshare' | 'generic'

/** 网页中解析出的单个资源 */
export interface WebResourceInfo {
  kind: WebResourceKind
  /** 资源绝对地址（相对路径已按页面地址补全，仅 http/https） */
  url: string
  /** 保存时默认使用的文件名（已清洗 Windows 非法字符） */
  fileName: string
  /** 资源字节数；解析阶段未知为 0 */
  sizeBytes: number
  /** 预览用封面地址（嵌入视频 / 无海报视频尽力给出） */
  coverUrl?: string
}

/** 网页资源解析结果（主进程 → 渲染进程） */
export interface WebResourceParseResult {
  /** 实际使用的站点解析器：gameshare / generic */
  siteId: string
  /** 页面标题，取不到为空串 */
  pageTitle: string
  /** 实际请求的页面地址 */
  pageUrl: string
  resources: WebResourceInfo[]
}

/** 单个网页资源下载参数 */
export interface WebResourceDownloadInput {
  url: string
  /** 资源所属页面地址，作 Referer 过防盗链 */
  referer?: string
  /** 另存为对话框的默认文件名 */
  defaultName: string
  /** 批量下载的目标目录；缺省时主进程弹另存为对话框 */
  outputDir?: string
}

/** 网页资源下载结果（下载结束才 resolve；用户在另存为里取消时返回 null 由调用方约定） */
export interface WebResourceDownloadResult {
  downloadId: string
  /** 实际写入的文件绝对路径 */
  savePath: string
  sizeBytes: number
  /** 用户主动取消为 true */
  canceled: boolean
}

/** 网页资源下载进度（主进程 → 渲染进程事件载荷） */
export interface WebResourceDownloadProgress {
  downloadId: string
  url: string
  receivedBytes: number
  /** 0 表示总大小未知 */
  totalBytes: number
  status: 'downloading' | 'succeeded' | 'failed' | 'canceled'
  /** status 为 failed 时的人类可读原因 */
  error?: string
}

/** 应用信息 */
export interface AppInfo {
  version: string
  electron: string
  platform: string
}

/** 当前项目里的 Agent Skill 条目（主进程扫描 SKILL.md 得到） */
export interface SkillItem {
  /** SKILL.md 绝对路径，同时作为条目唯一键 */
  path: string
  /** skill 目录绝对路径，「复制路径」给 AI 会话引用的就是它 */
  dir: string
  /** frontmatter 的 name，缺失时退回目录名 */
  name: string
  /** frontmatter 的 description，缺失时退回正文首段 */
  description: string
  /** 命中该条目的扫描根（仓库里 .agents 与 .qoder 两处都算项目级） */
  root: string
  sizeBytes: number
  /** 文件修改时间（epoch 毫秒） */
  updatedAt: number
  /** 同名 skill 在项目内两个扫描根里都存在，加载优先级不由本应用裁决 */
  duplicated: boolean
}

/** SKILL.md 正文读取结果 */
export interface SkillMarkdownResult {
  /** 去掉 frontmatter 后的正文 */
  body: string
  /** 文件超出读取上限，正文被截断 */
  truncated: boolean
}

/** 值类型元数据（UI 与引擎共用） */
export interface ValueTypeMeta {
  key: ValueType
  label: string
  size: number
  integer: boolean
}

export const VALUE_TYPE_META: Record<ValueType, ValueTypeMeta> = {
  f64: { key: 'f64', label: '双精度浮点 (f64)', size: 8, integer: false },
  f32: { key: 'f32', label: '单精度浮点 (f32)', size: 4, integer: false },
  i32: { key: 'i32', label: '32位整数 (i32)', size: 4, integer: true },
  i16: { key: 'i16', label: '16位整数 (i16)', size: 2, integer: true },
  i8: { key: 'i8', label: '8位整数 (i8)', size: 1, integer: true }
}

/** "自动" 模式默认覆盖的类型：覆盖 AVM double 与 Rust i32/f32 字段 */
export const AUTO_SCAN_TYPES: ValueType[] = ['f64', 'i32', 'f32']
