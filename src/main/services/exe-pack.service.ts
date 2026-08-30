import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

/**
 * Flash 转 EXE（独立播放器打包）。
 *
 * 原理（移植自 cali.so swf-to-exe）：Flash Player 独立播放器（projector）
 * 支持读取附加在自身末尾的 SWF：文件结构为
 *   [projector.exe] + [swf 字节] + [魔数 0xFA123456 小端 4B] + [swf 长度 u32 小端]
 * 播放器启动时检查尾部页脚，自动加载并运行附加的 SWF，实现双击即玩。
 */

/** Flash projector 读取附带 SWF 时使用的页脚魔数：0xFA123456（小端存储） */
export const FOOTER_MAGIC = [0x56, 0x34, 0x12, 0xfa] as const

const PROJECTOR_FILE_NAME = 'flash-projector.exe'

/**
 * 将 SWF 附加到播放器末尾，生成自运行 EXE。
 * 纯函数，不校验输入合法性（由调用方先行校验）。
 */
export function buildProjectorExe(projector: Uint8Array, swf: Uint8Array): Uint8Array {
  const footer = new Uint8Array(8)
  footer.set(FOOTER_MAGIC, 0)
  const length = swf.length
  footer[4] = length & 0xff
  footer[5] = (length >>> 8) & 0xff
  footer[6] = (length >>> 16) & 0xff
  footer[7] = (length >>> 24) & 0xff

  const out = new Uint8Array(projector.length + swf.length + footer.length)
  out.set(projector, 0)
  out.set(swf, projector.length)
  out.set(footer, projector.length + swf.length)
  return out
}

/** 校验是否为合法 SWF：文件头应为 FWS / CWS / ZWS */
export function isLikelySwf(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2])
  return signature === 'FWS' || signature === 'CWS' || signature === 'ZWS'
}

/** 校验是否为 Windows PE（projector）文件 */
export function isWindowsExecutable(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x4d && bytes[1] === 0x5a // 'MZ'
}

/**
 * 解析内置 projector 的路径：
 * 开发态取项目根 resources/；打包后取 electron-builder extraResources。
 */
export function resolveBundledProjectorPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', PROJECTOR_FILE_NAME)
  }
  return join(app.getAppPath(), 'resources', PROJECTOR_FILE_NAME)
}

/** 读取内置 projector 字节；资产缺失时抛出带指引的错误 */
export function readBundledProjector(): Uint8Array {
  const path = resolveBundledProjectorPath()
  const bytes = readFileSync(path)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
