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
}

/** oldswf 下载进度（主进程 → 渲染进程事件推送） */
export interface OldswfDownloadProgress {
  gameId: string
  /** starting 启动浏览器 / downloading 监听分片 / extracting 页面缓存提取 / saving 落盘 */
  phase: 'starting' | 'downloading' | 'extracting' | 'saving'
  /** 已接收字节数（去重分片求和） */
  receivedBytes: number
  /** 总字节数；0 表示尚不可知 */
  totalBytes: number
  /** 已捕获分片数 */
  chunkCount: number
}

/** oldswf 下载结果 */
export interface OldswfDownloadResult {
  gameId: string
  /** 保存的文件名（含扩展名），与游戏库记录 name 一致 */
  name: string
  /** 本地文件绝对路径（userData/games 目录下） */
  path: string
  sizeBytes: number
}

/** 文件选择结果 */
export interface SwfPickResult {
  path: string
  name: string
  size: number
}

/** 应用信息 */
export interface AppInfo {
  version: string
  electron: string
  platform: string
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
