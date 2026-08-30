import { app, dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { CheatProfile, GameRecord, SwfPatchSpec } from '@shared/types'
import { IPC } from '@shared/ipc'
import { logger } from './infra/logger'
import { pickSwfFile, pickSwfSavePath } from './services/dialog.service'
import { analyzeSwfPatch, patchSwf } from './services/swf-patch.service'
import {
  buildProjectorExe,
  isLikelySwf,
  isWindowsExecutable,
  readBundledProjector
} from './services/exe-pack.service'
import { OldswfDownloadService } from './services/oldswf/oldswf-download.service'
import { unpackSwfFromExeFile } from './services/exe-unpack.service'
import { GameService } from './services/game.service'
import { ProfileService } from './services/profile.service'

export interface MainContext {
  getMainWindow(): BrowserWindow | null
}

/** EXE 另存对话框（类型独立于 SWF 保存） */
async function showExeSaveDialog(defaultName: string): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: '保存独立 EXE',
    defaultPath: defaultName,
    filters: [{ name: '可执行文件', extensions: ['exe'] }]
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

/** 统一注册所有 IPC 处理器；返回反注册函数（当前应用生命周期无需注销，保留扩展点） */
export function registerIpcHandlers(context: MainContext): () => void {
  const games = new GameService(app.getPath('userData'))
  const profiles = new ProfileService(app.getPath('userData'))
  const win = () => context.getMainWindow()

  // oldswf 下载：文件落在 userData/games，进度实时推送给渲染层
  const oldswfDownloads = new OldswfDownloadService(
    join(app.getPath('userData'), 'games'),
    (progress) => {
      win()?.webContents.send(IPC.DOWNLOAD_OLDSWF_PROGRESS, progress)
    }
  )

  ipcMain.handle(IPC.APP_INFO, () => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    platform: process.platform
  }))

  ipcMain.handle(IPC.DIALOG_PICK_SWF, () => pickSwfFile(context.getMainWindow()))

  ipcMain.handle(IPC.GAMES_LIST, () => games.list())
  ipcMain.handle(IPC.GAMES_ADD, (_event, record: GameRecord) => games.upsert(record))
  ipcMain.handle(IPC.GAMES_REMOVE, (_event, hash: string) => games.remove(hash))

  ipcMain.handle(IPC.PROFILES_LIST, () => profiles.list())
  ipcMain.handle(IPC.PROFILES_LOAD, (_event, hash: string) => profiles.load(hash))
  ipcMain.handle(IPC.PROFILES_SAVE, (_event, profile: CheatProfile) => profiles.save(profile))
  ipcMain.handle(IPC.PROFILES_DELETE, (_event, hash: string) => profiles.remove(hash))

  // SWF 常量补丁：干跑分析 / 应用并另存
  ipcMain.handle(IPC.SWF_PATCH_ANALYZE, (_event, bytes: Uint8Array, specs: SwfPatchSpec[]) =>
    analyzeSwfPatch(bytes, specs)
  )
  ipcMain.handle(
    IPC.SWF_PATCH_SAVE,
    async (_event, bytes: Uint8Array, specs: SwfPatchSpec[], defaultName: string) => {
      const targetPath = await pickSwfSavePath(defaultName)
      if (!targetPath) return { canceled: true, report: [] }
      const { out, report } = patchSwf(bytes, specs)
      await writeFile(targetPath, out)
      logger.info('swf-patch', `已写出补丁 SWF：${targetPath}`)
      return { canceled: false, path: targetPath, report }
    }
  )

  // Flash 转 EXE：附加 SWF 到独立播放器末尾
  ipcMain.handle(
    IPC.EXE_PACK_SAVE,
    async (_event, swfBytes: Uint8Array, defaultName: string, customProjector?: Uint8Array) => {
      if (!isLikelySwf(swfBytes)) {
        throw new Error('不是有效的 SWF 文件（文件头应为 FWS/CWS/ZWS）')
      }
      const projector = customProjector ?? readBundledProjector()
      if (!isWindowsExecutable(projector)) {
        throw new Error('自定义播放器不是有效的 Windows EXE（缺少 MZ 头）')
      }
      const targetPath = await showExeSaveDialog(defaultName)
      if (!targetPath) return { canceled: true, exeSize: 0, projectorSize: projector.length }
      const exe = buildProjectorExe(projector, swfBytes)
      await writeFile(targetPath, exe)
      logger.info('exe-pack', `已生成独立 EXE：${targetPath}`)
      return {
        canceled: false,
        path: targetPath,
        exeSize: exe.length,
        projectorSize: projector.length
      }
    }
  )

  // oldswf 游戏下载：启动 / 取消 / 进度事件 / 定位文件
  ipcMain.handle(IPC.DOWNLOAD_OLDSWF, (_event, input: string) => oldswfDownloads.download(input))
  ipcMain.handle(IPC.DOWNLOAD_OLDSWF_CANCEL, () => oldswfDownloads.cancel())
  ipcMain.on(IPC.DOWNLOAD_SHOW_FILE, (_event, path: string) => {
    if (typeof path === 'string' && path) shell.showItemInFolder(path)
  })

  // EXE 还原：选 projector 封装的 EXE，按尾部页脚提取附加 SWF 并另存
  ipcMain.handle(IPC.EXE_UNPACK_SAVE, () => unpackSwfFromExeFile(context.getMainWindow()))

  // 无边框窗口控制：min/max/close 融合进自定义标题栏
  ipcMain.on(IPC.WINDOW_MINIMIZE, () => win()?.minimize())
  ipcMain.on(IPC.WINDOW_TOGGLE_MAXIMIZE, () => {
    const current = win()
    if (!current) return
    if (current.isMaximized()) current.unmaximize()
    else current.maximize()
  })
  ipcMain.on(IPC.WINDOW_CLOSE, () => win()?.close())
  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => win()?.isMaximized() ?? false)

  // 最大化状态推送给渲染层（控制按钮在 最大化/还原 图标间切换）
  const sendMaximized = (maximized: boolean): void => {
    win()?.webContents.send(IPC.WINDOW_MAXIMIZED_EVENT, maximized)
  }
  const window = win()
  window?.on('maximize', () => sendMaximized(true))
  window?.on('unmaximize', () => sendMaximized(false))

  logger.info('ipc', 'IPC 处理器注册完成')
  return () => ipcMain.removeAllListeners()
}
