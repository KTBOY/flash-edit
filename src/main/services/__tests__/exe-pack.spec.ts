import { describe, expect, it } from 'vitest'
import {
  buildProjectorExe,
  isLikelySwf,
  isWindowsExecutable,
  FOOTER_MAGIC
} from '../exe-pack.service'

const FAKE_PROJECTOR = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x01, 0x02, 0x03, 0x04])
const FAKE_SWF = new Uint8Array([0x46, 0x57, 0x53, 0x06, 0xaa, 0xbb, 0xcc, 0xdd, 0xee])

describe('Flash 转 EXE（projector 附加打包）', () => {
  it('结构：projector + swf + 魔数 4B + swf 长度 u32 小端', () => {
    const exe = buildProjectorExe(FAKE_PROJECTOR, FAKE_SWF)

    expect(exe.length).toBe(FAKE_PROJECTOR.length + FAKE_SWF.length + 8)
    // 前段 = projector
    expect(exe.subarray(0, FAKE_PROJECTOR.length)).toEqual(FAKE_PROJECTOR)
    // 中段 = swf
    expect(exe.subarray(FAKE_PROJECTOR.length, FAKE_PROJECTOR.length + FAKE_SWF.length)).toEqual(
      FAKE_SWF
    )
    // 页脚：魔数 + 长度
    const footer = exe.subarray(exe.length - 8)
    expect([...footer.subarray(0, 4)]).toEqual([...FOOTER_MAGIC])
    const swfLength = footer[4] | (footer[5] << 8) | (footer[6] << 16) | (footer[7] << 24)
    expect(swfLength).toBe(FAKE_SWF.length)
  })

  it('大 SWF（>64KB）长度字段按小端正确编码', () => {
    const bigSwf = new Uint8Array(200_000)
    bigSwf[0] = 0x46
    bigSwf[1] = 0x57
    bigSwf[2] = 0x53
    const exe = buildProjectorExe(FAKE_PROJECTOR, bigSwf)
    const footer = exe.subarray(exe.length - 8)
    const length = footer[4] | (footer[5] << 8) | (footer[6] << 16) | (footer[7] << 24)
    expect(length).toBe(200_000)
  })

  it('isLikelySwf 识别 FWS/CWS/ZWS，拒绝其他', () => {
    expect(isLikelySwf(new Uint8Array([0x46, 0x57, 0x53, 6]))).toBe(true) // FWS
    expect(isLikelySwf(new Uint8Array([0x43, 0x57, 0x53, 6]))).toBe(true) // CWS
    expect(isLikelySwf(new Uint8Array([0x5a, 0x57, 0x53, 6]))).toBe(true) // ZWS
    expect(isLikelySwf(new Uint8Array([0x4d, 0x5a, 0x90]))).toBe(false) // MZ
    expect(isLikelySwf(new Uint8Array([0x46, 0x57]))).toBe(false) // 过短
  })

  it('isWindowsExecutable 校验 MZ 头', () => {
    expect(isWindowsExecutable(FAKE_PROJECTOR)).toBe(true)
    expect(isWindowsExecutable(FAKE_SWF)).toBe(false)
  })
})
