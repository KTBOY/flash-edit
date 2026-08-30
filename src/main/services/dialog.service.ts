import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { statSync } from 'node:fs'
import type { SwfPickResult } from '@shared/types'

const SWF_FILTERS = [
  { name: 'Flash 游戏 (SWF)', extensions: ['swf', 'spl'] },
  { name: '所有文件', extensions: ['*'] }
]

/** 弹出系统文件选择框，返回选中的 SWF 信息；取消返回 null */
export async function pickSwfFile(parent?: BrowserWindow | null): Promise<SwfPickResult | null> {
  const result = await dialog.showOpenDialog(parent ?? (undefined as never), {
    title: '选择 Flash 游戏文件',
    filters: SWF_FILTERS,
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const filePath = result.filePaths[0]
  const size = statSync(filePath).size
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  return { path: filePath, name, size }
}

/** 弹出另存对话框，返回目标路径；取消返回 null */
export async function pickSwfSavePath(defaultName: string): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: '保存修改后的 SWF',
    defaultPath: defaultName,
    filters: [{ name: 'Flash (SWF)', extensions: ['swf'] }]
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
}
