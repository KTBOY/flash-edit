import { deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { SwfPatchSpec } from '@shared/types'
import { patchSwf } from '../swf-patch.service'

// ---------- 测试用 SWF/ABC 构造工具 ----------

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

function f64Bytes(value: number): number[] {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setFloat64(0, value, true)
  return [...new Uint8Array(buf)]
}

function f32Bytes(value: number): number[] {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setFloat32(0, value, true)
  return [...new Uint8Array(buf)]
}

/** 构造最小 ABC 块：版本 + 整数池 + 无符号池 + double 池 + 尾部 */
function buildAbc(options: { ints?: number[]; uints?: number[]; doubles?: number[]; tail?: number[] }): number[] {
  const { ints = [], uints = [], doubles = [], tail = [0x00, 0x00, 0x00, 0x00] } = options
  const bytes: number[] = [0x10, 0x00, 0x2e, 0x00] // minor=0x0010 major=0x002e (LE)
  bytes.push(...encodeVarint(ints.length + 1))
  for (const v of ints) bytes.push(...encodeVarint(v))
  bytes.push(...encodeVarint(uints.length + 1))
  for (const v of uints) bytes.push(...encodeVarint(v))
  bytes.push(...encodeVarint(doubles.length + 1))
  for (const v of doubles) bytes.push(...f64Bytes(v))
  bytes.push(...tail)
  return bytes
}

function tagHeader(code: number, length: number): number[] {
  if (length < 0x3f) {
    const v = (code << 6) | length
    return [v & 0xff, v >> 8]
  }
  const v = (code << 6) | 0x3f
  return [
    v & 0xff,
    v >> 8,
    length & 0xff,
    (length >> 8) & 0xff,
    (length >> 16) & 0xff,
    (length >> 24) & 0xff
  ]
}

/** FWS（未压缩）SWF：8 字节头 + 标签流 */
function buildFws(tags: number[][]): Uint8Array {
  const body = tags.flat()
  const total = 8 + body.length
  const bytes = [
    0x46, 0x57, 0x53, 6, // 'FWS' version 6
    total & 0xff,
    (total >> 8) & 0xff,
    (total >> 16) & 0xff,
    (total >> 24) & 0xff
  ]
  return new Uint8Array([...bytes, ...body])
}

/** CWS（zlib）SWF */
function buildCws(tags: number[][]): Uint8Array {
  const fws = buildFws(tags)
  const compressed = deflateSync(fws.subarray(8))
  const out = new Uint8Array(8 + compressed.length)
  out.set([0x43, 0x57, 0x53, 6], 0)
  out.set(fws.subarray(4, 8), 4)
  out.set(compressed, 8)
  return out
}

/** DoABC(82)：flags(4B) + name(cstring) + ABC */
function doAbcTag(abc: number[]): number[] {
  const payload = [0x00, 0x00, 0x00, 0x00, 0x67, 0x00, ...abc] // flags=0, name="g"
  return [...tagHeader(82, payload.length), ...payload]
}

function spec(over: Partial<SwfPatchSpec> & Pick<SwfPatchSpec, 'kind' | 'original' | 'value'>): SwfPatchSpec {
  return { id: 't1', desc: '测试项', ...over }
}

function doubleAt(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(offset, true)
}

// ---------- 用例 ----------

describe('SWF 常量补丁', () => {
  it('DoABC1(72)：double 池按值匹配并原地改写', () => {
    const abc = buildAbc({ doubles: [100, 55.5], ints: [100] })
    const swf = buildFws([[...tagHeader(72, abc.length), ...abc]])
    const result = patchSwf(swf, [spec({ kind: 'f64', original: 55.5, value: 999.25 })])

    expect(result.report[0]).toMatchObject({ sites: 1, skipped: 0 })
    const dv = new DataView(result.out.buffer)
    // double 池位于 ABC 起始 4+1+1+2 +1+1 +1+1 = 12 字节处，第二项
    const view = new DataView(result.out.buffer, result.out.byteOffset)
    let found = 0
    for (let off = 8; off + 8 <= result.out.length; off++) {
      const v = view.getFloat64(off, true)
      if (v === 999.25) found++
      if (v === 55.5) throw new Error('原值未被替换')
    }
    expect(found).toBe(1)
    void dv
  })

  it('DoABC(82)：正确跳过 flags+name 定位 ABC', () => {
    const abc = buildAbc({ doubles: [500] })
    const swf = buildFws([[...doAbcTag(abc)]])
    const result = patchSwf(swf, [spec({ kind: 'f64', original: 500, value: 12345 })])
    expect(result.report[0].sites).toBe(1)
    expect(doubleAt(result.out, result.out.length - 12 - 0)).toBe(12345)
  })

  it('CWS(zlib)：解压补丁后重新压缩且可还原', () => {
    const abc = buildAbc({ doubles: [42] })
    const swf = buildCws([[...tagHeader(72, abc.length), ...abc]])
    expect(swf[0]).toBe(0x43) // 'C'
    const result = patchSwf(swf, [spec({ kind: 'f64', original: 42, value: 77 })])
    expect(result.out[0]).toBe(0x43)
    // 还原校验
    const inflated = inflateSync(result.out.subarray(8))
    const full = new Uint8Array(8 + inflated.length)
    full.set(result.out.subarray(0, 8))
    full.set(inflated, 8)
    const view = new DataView(full.buffer)
    let found = false
    for (let off = 8; off + 8 <= full.length; off++) {
      if (view.getFloat64(off, true) === 77) found = true
    }
    expect(found).toBe(true)
  })

  it('整数池：变长编码等长时原地改写，不等长时跳过', () => {
    // 100 的 u30 编码为 1 字节；88 同为 1 字节（等长→改写），300 为 2 字节（不等长→跳过）
    const abc = buildAbc({ ints: [100, 100] })
    const swf = buildFws([[...tagHeader(72, abc.length), ...abc]])
    const result = patchSwf(swf, [spec({ kind: 'i32', original: 100, value: 88 })])
    expect(result.report[0].sites).toBe(2)

    const result2 = patchSwf(swf, [spec({ kind: 'i32', original: 100, value: 300 })])
    expect(result2.report[0].sites).toBe(0)
    expect(result2.report[0].skipped).toBe(2)
  })

  it('AVM1：无 ABC 标签时按双精度字节全文件匹配', () => {
    const actionBytes = [0x00, ...f64Bytes(55.5), 0xaa, 0xbb, ...f64Bytes(55.5), 0x00]
    const swf = buildFws([[...tagHeader(12, actionBytes.length), ...actionBytes]]) // 12 = DoAction
    const result = patchSwf(swf, [spec({ kind: 'f64', original: 55.5, value: 66.6 })])
    expect(result.report[0].sites).toBe(2)
  })

  it('AVM1：f32 单精度匹配', () => {
    const actionBytes = [0x00, ...f32Bytes(1.5), ...f32Bytes(1.5)]
    const swf = buildFws([[...tagHeader(12, actionBytes.length), ...actionBytes]])
    const result = patchSwf(swf, [spec({ kind: 'f32', original: 1.5, value: 9.5 })])
    expect(result.report[0].sites).toBe(2)
  })

  it('AVM2 文件不做原始字节匹配（避免与常量池重复命中）', () => {
    const abc = buildAbc({ doubles: [55.5] })
    const tail = [...f64Bytes(55.5)] // 文件其它位置还有一个相同字节序列
    const payload = [...abc, ...tail]
    const swf = buildFws([[...tagHeader(72, payload.length), ...payload]])
    const result = patchSwf(swf, [spec({ kind: 'f64', original: 55.5, value: 1 })])
    expect(result.report[0].sites).toBe(1)
  })

  it('i32 在 AVM1 文件（无 ABC）不支持原始匹配，返回 0 命中', () => {
    const swf = buildFws([[...tagHeader(0, 0)]]) // End 标签
    const result = patchSwf(swf, [spec({ kind: 'i32', original: 100, value: 200 })])
    expect(result.report[0].sites).toBe(0)
  })

  it('ZWS(LZMA) 明确报错', () => {
    const bytes = new Uint8Array([0x5a, 0x57, 0x53, 6, 0, 0, 0, 0, 1, 2, 3])
    expect(() => patchSwf(bytes, [spec({ kind: 'f64', original: 1, value: 2 })])).toThrow('LZMA')
  })

  it('非法文件头报错', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 6, 0, 0, 0, 0])
    expect(() => patchSwf(bytes, [])).toThrow('SWF')
  })
})
