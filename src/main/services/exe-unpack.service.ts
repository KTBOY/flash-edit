import type { BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ExeUnpackResult } from '@shared/types'
import { logger } from '../infra/logger'
import { pickExeFile, pickSwfSavePath } from './dialog.service'
import { FOOTER_MAGIC } from './exe-pack.service'

/**
 * EXE 还原（打包 EXE 的逆向操作）。
 *
 * Flash projector 封装的 EXE 尾部带有 8 字节页脚：
 *   [魔数 0xFA123456 小端 4B] + [swf 长度 u32 小端]
 * 读取页脚即可从文件末尾定位出附加的 SWF（起始偏移 = 文件长 - 8 - swf 长度），
 * 校验 SWF 文件头后切片另存，即得到原始 Flash 文件。
 */

export interface SwfFooterInfo {
  /** 附加 SWF 在 EXE 内的起始偏移 */
  swfOffset: number
  /** 附加 SWF 的字节数 */
  swfSize: number
  /** EXE 中 projector 部分的字节数（= swfOffset） */
  projectorSize: number
  magic: 'FWS' | 'CWS' | 'ZWS'
}

/** 纯逻辑：按尾部页脚定位 EXE 附加的 SWF；结构不符（非 projector 封装/已损坏）返回 null */
export function locateAppendedSwf(bytes: Uint8Array): SwfFooterInfo | null {
  const size = bytes.length
  // 最小合法结构：8 字节页脚 + 3 字节 SWF 头
  if (size < 11) return null
  const footer = bytes.subarray(size - 8)
  for (let i = 0; i < 4; i++) {
    if (footer[i] !== FOOTER_MAGIC[i]) return null
  }
  const swfSize = footer[4] | (footer[5] << 8) | (footer[6] << 16) | (footer[7] << 24)
  if (swfSize <= 0 || swfSize + 8 > size) return null
  const swfOffset = size - 8 - swfSize
  const head = bytes.subarray(swfOffset, swfOffset + 3)
  const magic = String.fromCharCode(head[0], head[1], head[2])
  if (magic !== 'FWS' && magic !== 'CWS' && magic !== 'ZWS') return null
  return { swfOffset, swfSize, projectorSize: swfOffset, magic }
}

/** EXE 还原流程：选 EXE → 定位附加 SWF → 另存；对话框全部由主进程弹出 */
export async function unpackSwfFromExeFile(
  parent?: BrowserWindow | null
): Promise<ExeUnpackResult> {
  const picked = await pickExeFile(parent)
  if (!picked) return { status: 'pick-canceled' }

  const buffer = await readFile(picked.path)
  const exeBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const info = locateAppendedSwf(exeBytes)
  if (!info) return { status: 'not-found' }

  const defaultName = `${picked.name.replace(/\.exe$/i, '')}.swf`
  const targetPath = await pickSwfSavePath(defaultName, '保存提取的 SWF')
  if (!targetPath) {
    return {
      status: 'save-canceled',
      swfSize: info.swfSize,
      projectorSize: info.projectorSize,
      magic: info.magic
    }
  }

  await writeFile(targetPath, exeBytes.subarray(info.swfOffset, info.swfOffset + info.swfSize))
  logger.info(
    'exe-unpack',
    `已从 ${picked.path} 提取 SWF：${targetPath}（${info.magic}，${(info.swfSize / 1024 / 1024).toFixed(2)} MB，projector ${(info.projectorSize / 1024 / 1024).toFixed(2)} MB）`
  )
  return {
    status: 'saved',
    path: targetPath,
    name: basename(targetPath),
    swfSize: info.swfSize,
    projectorSize: info.projectorSize,
    magic: info.magic
  }
}
