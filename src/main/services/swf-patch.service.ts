import { inflateSync, deflateSync } from 'node:zlib'
import type { SwfPatchReportItem, SwfPatchSpec } from '@shared/types'

/**
 * SWF 常量补丁服务（离线修改，路线 C）。
 *
 * 原理：
 * - AS3(AVM2) 游戏：数值字面量存放在 DoABC 标签内 ABC 常量池（double 池为 8 字节
 *   IEEE754，int/uint 池为变长 u30）。定位常量池后原地改写——不改文件结构。
 * - AS2(AVM1) 老游戏：PushDouble/PushFloat 以原始字节内联在字节码中，按双精度/
 *   单精度字节模式做全文件匹配（仅在文件不含 ABC 标签时启用，避免重复命中）。
 * - i32 匹配仅覆盖 ABC 整数池，且要求新旧值的 u30 变长编码长度一致（原地写回），
 *   长度不一致则跳过并计入 skipped。
 *
 * 写出的文件保持原压缩方式：FWS 保持不压缩，CWS 重新 zlib 压缩。ZWS(LZMA) 不支持。
 */

const ABC_MAGIC_MINOR = 0x0010
const ABC_MAGIC_MAJOR = 0x002e
const TAG_DO_ABC = 82
const TAG_DO_ABC1 = 72

interface AbcBlock {
  start: number
}

// ---------- 基础编解码 ----------

interface Varint {
  value: number
  length: number
}

function readVarint(buf: Uint8Array, pos: number): Varint {
  let value = 0
  let shift = 0
  let length = 0
  // u30/s32 最多 5 字节；只用于跳过或整数池比对，第 5 字节高位丢弃与 AVM 语义一致
  while (length < 5) {
    const byte = buf[pos + length]
    value |= (byte & 0x7f) << shift
    length += 1
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value: value | 0, length }
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = []
  let v = value >>> 0
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v > 0) byte |= 0x80
    bytes.push(byte)
  } while (v > 0)
  return bytes
}

// ---------- 解压 / 压缩 ----------

export type SwfCompression = 'none' | 'zlib'

interface InflatedSwf {
  buf: Uint8Array
  compression: SwfCompression
  version: number
}

function inflateSwf(bytes: Uint8Array): InflatedSwf {
  if (bytes.length < 8) throw new Error('SWF 文件过小，不是有效的 Flash 文件')
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2])
  const version = bytes[3]
  if (magic === 'FWS') {
    return { buf: bytes.slice(), compression: 'none', version }
  }
  if (magic === 'CWS') {
    const body = inflateSync(bytes.subarray(8))
    const buf = new Uint8Array(8 + body.length)
    buf.set(bytes.subarray(0, 8))
    buf.set(body, 8)
    return { buf, compression: 'zlib', version }
  }
  if (magic === 'ZWS') {
    throw new Error('暂不支持 LZMA 压缩（ZWS）的 SWF，请先用工具转存为普通压缩格式')
  }
  throw new Error('不是有效的 SWF 文件（文件头错误）')
}

function recompress(inflated: InflatedSwf): Uint8Array {
  if (inflated.compression === 'none') {
    return inflated.buf
  }
  const compressed = deflateSync(inflated.buf.subarray(8), { level: 9 })
  const out = new Uint8Array(8 + compressed.length)
  out[0] = 0x43 // 'C'
  out[1] = 0x57 // 'W'
  out[2] = 0x53 // 'S'
  out[3] = inflated.version
  // 文件长度字段 = 未压缩总长（保持原值）
  out.set(inflated.buf.subarray(4, 8), 4)
  out.set(compressed, 8)
  return out
}

// ---------- 标签遍历 ----------

interface SwfTag {
  code: number
  payloadStart: number
  payloadLength: number
}

function walkTags(buf: Uint8Array, visit: (tag: SwfTag) => void): void {
  let pos = 8
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  while (pos + 2 <= buf.length) {
    const codeAndLength = dv.getUint16(pos, true)
    const code = codeAndLength >> 6
    let length = codeAndLength & 0x3f
    let headerSize = 2
    if (length === 0x3f) {
      if (pos + 6 > buf.length) break
      length = dv.getInt32(pos + 2, true)
      headerSize = 6
      if (length < 0) break
    }
    const payloadStart = pos + headerSize
    if (payloadStart + length > buf.length) break
    visit({ code, payloadStart, payloadLength: length })
    pos = payloadStart + length
  }
}

/** 校验 pos 处是否为 ABC 版本魔数（minor=0x0010, major=0x002e） */
function magicAt(buf: Uint8Array, pos: number, limit: number): boolean {
  if (pos + 4 > limit) return false
  const minor = buf[pos] | (buf[pos + 1] << 8)
  const major = buf[pos + 2] | (buf[pos + 3] << 8)
  return minor === ABC_MAGIC_MINOR && major === ABC_MAGIC_MAJOR
}

/**
 * 在 DoABC/DoABC1 载荷内定位 ABC 起始。
 * DoABC(82)：flags(4B) + name(cstring) + ABC —— 先按规范解析，失败再在头部小范围内扫魔数兜底；
 * DoABC1(72)：载荷即 ABC。
 */
function locateAbc(buf: Uint8Array, tag: SwfTag): AbcBlock | null {
  const limit = tag.payloadStart + tag.payloadLength
  if (tag.code === TAG_DO_ABC1) {
    return magicAt(buf, tag.payloadStart, limit) ? { start: tag.payloadStart } : null
  }
  let canonical = tag.payloadStart + 4
  while (canonical < limit && buf[canonical] !== 0) canonical += 1
  canonical += 1
  if (magicAt(buf, canonical, limit)) return { start: canonical }
  const searchLimit = Math.min(limit, tag.payloadStart + 4 + 512)
  for (let pos = tag.payloadStart + 4; pos < searchLimit; pos++) {
    if (magicAt(buf, pos, limit)) return { start: pos }
  }
  return null
}

// ---------- 常量池补丁 ----------

interface PoolPatchStats {
  sites: number
  skipped: number
}

function patchAbcConstantPool(
  buf: Uint8Array,
  abc: AbcBlock,
  dv: DataView,
  spec: SwfPatchSpec
): PoolPatchStats {
  const stats: PoolPatchStats = { sites: 0, skipped: 0 }
  let pos = abc.start + 4 // 跳过 minor/major

  // 整数池（s32 变长）与无符号整数池（u30 变长）：i32 类补丁在此原地改写
  for (let pool = 0; pool < 2; pool++) {
    const count = readVarint(buf, pos)
    pos += count.length
    for (let i = 1; i < count.value; i++) {
      const entry = readVarint(buf, pos)
      if (spec.kind === 'i32' && entry.value === spec.original) {
        const encoded = encodeVarint(spec.value)
        if (encoded.length === entry.length) {
          buf.set(encoded, pos)
          stats.sites += 1
        } else {
          stats.skipped += 1
        }
      }
      pos += entry.length
    }
  }

  // double 池：(count-1) × 8 字节连续存放
  const doubleCount = readVarint(buf, pos)
  pos += doubleCount.length
  const doubleStart = pos
  for (let i = 1; i < doubleCount.value; i++) {
    const offset = doubleStart + (i - 1) * 8
    if (offset + 8 > buf.length) break
    if (spec.kind === 'f64' && dv.getFloat64(offset, true) === spec.original) {
      dv.setFloat64(offset, spec.value, true)
      stats.sites += 1
    }
  }
  return stats
}

// ---------- AVM1 原始字节匹配 ----------

function patchRawFloats(dv: DataView, length: number, spec: SwfPatchSpec): PoolPatchStats {
  const stats: PoolPatchStats = { sites: 0, skipped: 0 }
  if (!Number.isFinite(spec.original)) return stats
  if (spec.kind === 'i32') return stats // 4 字节整数全文匹配误伤率过高，不支持
  const width = spec.kind === 'f64' ? 8 : 4
  for (let offset = 8; offset + width <= length; offset += 1) {
    const current =
      spec.kind === 'f64' ? dv.getFloat64(offset, true) : dv.getFloat32(offset, true)
    if (current !== spec.original) continue
    if (spec.kind === 'f64') dv.setFloat64(offset, spec.value, true)
    else dv.setFloat32(offset, spec.value, true)
    stats.sites += 1
  }
  return stats
}

// ---------- 对外接口 ----------

export interface SwfPatchOutcome {
  out: Uint8Array
  report: SwfPatchReportItem[]
}

/**
 * 应用常量补丁并返回补丁后的 SWF 字节（不写盘）。
 * 输入字节不会被修改。
 */
export function patchSwf(bytes: Uint8Array, specs: SwfPatchSpec[]): SwfPatchOutcome {
  const inflated = inflateSwf(bytes)
  const buf = inflated.buf
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  // 1. 收集 ABC 块（AS3 游戏标记）
  const abcBlocks: AbcBlock[] = []
  walkTags(buf, (tag) => {
    if (tag.code !== TAG_DO_ABC && tag.code !== TAG_DO_ABC1) return
    const located = locateAbc(buf, tag)
    if (located) abcBlocks.push(located)
  })

  const isAvm2 = abcBlocks.length > 0

  // 2. 逐条应用补丁
  const report: SwfPatchReportItem[] = specs.map((spec) => {
    const stats: PoolPatchStats = { sites: 0, skipped: 0 }
    if (isAvm2) {
      for (const abc of abcBlocks) {
        const pool = patchAbcConstantPool(buf, abc, dv, spec)
        stats.sites += pool.sites
        stats.skipped += pool.skipped
      }
      // AS3 文件不做原始字节匹配，避免与常量池重复命中
    } else {
      const raw = patchRawFloats(dv, buf.length, spec)
      stats.sites += raw.sites
      stats.skipped += raw.skipped
    }
    return { id: spec.id, desc: spec.desc, sites: stats.sites, skipped: stats.skipped }
  })

  // 3. 重压缩输出
  return { out: recompress(inflated), report }
}

/** 干跑：只算命中数，返回报告 */
export function analyzeSwfPatch(bytes: Uint8Array, specs: SwfPatchSpec[]): SwfPatchReportItem[] {
  return patchSwf(bytes, specs).report
}
