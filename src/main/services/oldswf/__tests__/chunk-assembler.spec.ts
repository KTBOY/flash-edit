import { describe, expect, it } from 'vitest'
import { isSwfMagic, parseContentRange, SwfChunkAssembler } from '../chunk-assembler'

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

describe('parseContentRange', () => {
  it('解析标准 bytes start-end/total', () => {
    expect(parseContentRange('bytes 0-131071/1048576')).toEqual({
      start: 0,
      end: 131071,
      total: 1048576
    })
  })

  it('容忍大小写', () => {
    expect(parseContentRange('Bytes 4096-8191/1048576')).toEqual({
      start: 4096,
      end: 8191,
      total: 1048576
    })
  })

  it('非法格式返回 null', () => {
    expect(parseContentRange('bytes */1048576')).toBeNull()
    expect(parseContentRange('')).toBeNull()
    expect(parseContentRange('application/octet-stream')).toBeNull()
  })
})

describe('isSwfMagic', () => {
  it('接受 FWS / CWS / ZWS', () => {
    expect(isSwfMagic(new TextEncoder().encode('FWS'))).toBe(true)
    expect(isSwfMagic(new TextEncoder().encode('CWS'))).toBe(true)
    expect(isSwfMagic(new TextEncoder().encode('ZWS'))).toBe(true)
  })

  it('拒绝其他文件头与过短输入', () => {
    expect(isSwfMagic(new TextEncoder().encode('ELF'))).toBe(false)
    expect(isSwfMagic(bytes(0x46, 0x57))).toBe(false)
    expect(isSwfMagic(new Uint8Array(0))).toBe(false)
  })
})

describe('SwfChunkAssembler', () => {
  it('乱序到达的分片按偏移重组', () => {
    const asm = new SwfChunkAssembler()
    asm.addChunk(2, bytes(0x33, 0x34), 4)
    asm.addChunk(0, bytes(0x11, 0x22), 4)
    expect(asm.isComplete()).toBe(true)
    expect([...(asm.assemble() ?? [])]).toEqual([0x11, 0x22, 0x33, 0x34])
  })

  it('未集齐时 isComplete 为 false 且 assemble 返回 null', () => {
    const asm = new SwfChunkAssembler()
    asm.addChunk(0, bytes(1, 2), 8)
    expect(asm.isComplete()).toBe(false)
    expect(asm.assemble()).toBeNull()
    expect(asm.receivedBytes).toBe(2)
    expect(asm.totalSize).toBe(8)
  })

  it('同一偏移的分片覆盖而不重复计数', () => {
    const asm = new SwfChunkAssembler()
    asm.addChunk(0, bytes(1, 2), 2)
    asm.addChunk(0, bytes(9, 9), 2)
    expect(asm.receivedBytes).toBe(2)
    expect(asm.chunkCount).toBe(1)
    expect([...(asm.assemble() ?? [])]).toEqual([9, 9])
  })

  it('total 取各分片声明中的最大值', () => {
    const asm = new SwfChunkAssembler()
    asm.addChunk(0, bytes(1), 100)
    asm.addChunk(1, bytes(2), 200)
    expect(asm.totalSize).toBe(200)
  })

  it('setFullBody 直接完成', () => {
    const asm = new SwfChunkAssembler()
    asm.setFullBody(bytes(0x46, 0x57, 0x53))
    expect(asm.isComplete()).toBe(true)
    expect(asm.chunkCount).toBe(1)
    expect([...(asm.assemble() ?? [])]).toEqual([0x46, 0x57, 0x53])
  })

  it('total 未知（0）时即使收到分片也不算集齐', () => {
    const asm = new SwfChunkAssembler()
    asm.addChunk(0, bytes(1, 2, 3))
    expect(asm.isComplete()).toBe(false)
    expect(asm.assemble()).toBeNull()
  })
})
