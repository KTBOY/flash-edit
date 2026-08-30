import { describe, expect, it } from 'vitest'
import { buildProjectorExe } from '../exe-pack.service'
import { locateAppendedSwf } from '../exe-unpack.service'

const FAKE_PROJECTOR = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x01, 0x02, 0x03, 0x04])
const FAKE_FWS = new Uint8Array([0x46, 0x57, 0x53, 0x06, 0xaa, 0xbb, 0xcc, 0xdd, 0xee])
const FAKE_CWS = new Uint8Array([0x43, 0x57, 0x53, 0x06, 0x11, 0x22, 0x33])

describe('EXE 还原（定位 projector 附加的 SWF）', () => {
  it('打包 → 还原往返：字段与字节完全还原', () => {
    const exe = buildProjectorExe(FAKE_PROJECTOR, FAKE_FWS)
    const info = locateAppendedSwf(exe)

    expect(info).not.toBeNull()
    expect(info!.magic).toBe('FWS')
    expect(info!.swfOffset).toBe(FAKE_PROJECTOR.length)
    expect(info!.swfSize).toBe(FAKE_FWS.length)
    expect(info!.projectorSize).toBe(FAKE_PROJECTOR.length)
    expect(exe.subarray(info!.swfOffset, info!.swfOffset + info!.swfSize)).toEqual(FAKE_FWS)
  })

  it('支持 zlib 压缩 SWF（CWS）', () => {
    const exe = buildProjectorExe(FAKE_PROJECTOR, FAKE_CWS)
    const info = locateAppendedSwf(exe)
    expect(info?.magic).toBe('CWS')
    expect(info?.swfSize).toBe(FAKE_CWS.length)
  })

  it('大 SWF（>64KB）长度按小端正确解码', () => {
    const bigSwf = new Uint8Array(200_000)
    bigSwf[0] = 0x46
    bigSwf[1] = 0x57
    bigSwf[2] = 0x53
    const info = locateAppendedSwf(buildProjectorExe(FAKE_PROJECTOR, bigSwf))
    expect(info?.swfSize).toBe(200_000)
  })

  it('无页脚（普通 EXE）返回 null', () => {
    expect(locateAppendedSwf(FAKE_PROJECTOR)).toBeNull()
  })

  it('页脚魔数不符返回 null', () => {
    const exe = buildProjectorExe(FAKE_PROJECTOR, FAKE_FWS)
    exe[exe.length - 8] = 0x00 // 破坏魔数
    expect(locateAppendedSwf(exe)).toBeNull()
  })

  it('长度字段虚报（超出文件范围）返回 null', () => {
    const exe = buildProjectorExe(FAKE_PROJECTOR, FAKE_FWS)
    exe[exe.length - 4] = 0xff // 长度改为 0xffffff09
    expect(locateAppendedSwf(exe)).toBeNull()
  })

  it('长度为 0 返回 null', () => {
    const exe = buildProjectorExe(FAKE_PROJECTOR, FAKE_FWS)
    exe.fill(0, exe.length - 4)
    expect(locateAppendedSwf(exe)).toBeNull()
  })

  it('页脚指向的偏移不是 SWF 文件头返回 null', () => {
    // 页脚声称长度 4 → 偏移落在 SWF 中段，该处字节非 FWS/CWS/ZWS
    const exe = buildProjectorExe(FAKE_PROJECTOR, FAKE_FWS)
    const claimed = new Uint8Array(8)
    claimed.set([0x56, 0x34, 0x12, 0xfa], 0)
    claimed[4] = 4 // 声称 SWF 只有 4 字节 → 偏移指向 projector 尾部
    exe.set(claimed, exe.length - 8)
    expect(locateAppendedSwf(exe)).toBeNull()
  })

  it('过短输入返回 null', () => {
    expect(locateAppendedSwf(new Uint8Array(0))).toBeNull()
    expect(locateAppendedSwf(new Uint8Array(8))).toBeNull()
  })
})
