import { app, dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { unlink, writeFile } from 'node:fs/promises'
import type { CheatProfile, GamesDeleteResult, GameRecord, SwfPatchSpec } from '@shared/types'
import { IPC } from '@shared/ipc'
import { isInsideDir } from './infra/paths'
import { logger } from './infra/logger'
import { pickSwfFile, pickSwfSavePath, pickDirectory } from './services/dialog.service'
import { analyzeSwfPatch, patchSwf } from './services/swf-patch.service'
import {
  buildProjectorExe,
  isLikelySwf,
  isWindowsExecutable,
  readBundledProjector
} from './services/exe-pack.service'
import { OldswfDownloadManager } from './services/oldswf/oldswf-download.service'
import { unpackSwfFromExeFile } from './services/exe-unpack.service'
import { GameService } from './services/game.service'
import { ProfileService } from './services/profile.service'
import { SettingsService } from './services/settings.service'

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
  const settings = new SettingsService(app.getPath('userData'))
  const win = () => context.getMainWindow()

  // oldswf 下载：多任务队列，保存目录由设置驱动（未设置时回退 userData/games），
  // 落盘成功即刻登记游戏库，任务状态与进度实时推送给渲染层
  const oldswfDownloads = new OldswfDownloadManager(
    () => settings.downloadDir(),
    (task) => {
      win()?.webContents.send(IPC.DOWNLOAD_OLDSWF_TASK, task)
    },
    (result, hash) => {
      games.upsert({
        hash,
        name: result.name,
        size: result.sizeBytes,
        lastPlayed: new Date().toISOString(),
        source: 'download',
        path: result.path
      })
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
  ipcMain.handle(IPC.GAMES_DELETE, async (_event, hashes: unknown, deleteFiles: unknown) => {
    const list = Array.isArray(hashes)
      ? hashes.filter((hash): hash is string => typeof hash === 'string')
      : []
    const removed = games.removeMany(list)
    const result: GamesDeleteResult = { deletedFiles: [], keptFiles: [], failedFiles: [] }
    if (deleteFiles !== true) return result

    const downloadDir = settings.downloadDir()
    for (const record of removed) {
      const path = record.path
      if (!path) continue
      if (!isInsideDir(path, downloadDir)) {
        result.keptFiles.push(path)
        continue
      }
      try {
        await unlink(path)
        result.deletedFiles.push(path)
      } catch (error) {
        result.failedFiles.push(path)
        logger.warn(
          'games',
          `删除文件失败 ${path}：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    logger.info(
      'games',
      `删除 ${removed.length} 条记录，其中文件已删 ${result.deletedFiles.length}、目录外保留 ${result.keptFiles.length}、失败 ${result.failedFiles.length}`
    )
    return result
  })

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
      logger.info(
        'exe-pack',
        `已生成独立 EXE：${targetPath}`,
        `SWF ${(swfBytes.length / 1024 / 1024).toFixed(2)} MB ·`,
        customProjector ? '自定义播放器' : '内置播放器',
        `${(projector.length / 1024 / 1024).toFixed(2)} MB · 合计 ${(exe.length / 1024 / 1024).toFixed(2)} MB`
      )
      return {
        canceled: false,
        path: targetPath,
        exeSize: exe.length,
        projectorSize: projector.length
      }
    }
  )

  // oldswf 游戏下载：提交 / 取消 / 列表 / 清除已结束 / 任务事件 / 定位文件
  ipcMain.handle(IPC.DOWNLOAD_OLDSWF, (_event, input: string) =>
    oldswfDownloads.start(String(input ?? ''))
  )
  ipcMain.handle(IPC.DOWNLOAD_OLDSWF_CANCEL, (_event, gameId: string) =>
    typeof gameId === 'string' ? oldswfDownloads.cancel(gameId) : false
  )
  ipcMain.handle(IPC.DOWNLOAD_OLDSWF_LIST, () => oldswfDownloads.list())
  ipcMain.handle(IPC.DOWNLOAD_OLDSWF_REMOVE, (_event, gameIds: unknown) => {
    if (!Array.isArray(gameIds)) return
    oldswfDownloads.remove(gameIds.filter((id): id is string => typeof id === 'string'))
  })
  ipcMain.on(IPC.DOWNLOAD_SHOW_FILE, (_event, path: string) => {
    if (typeof path === 'string' && path) shell.showItemInFolder(path)
  })

  // 应用设置：读取生效下载目录 / 弹出目录选择框修改下载保存位置
  ipcMain.handle(IPC.SETTINGS_GET, () => settings.get())
  ipcMain.handle(IPC.SETTINGS_PICK_DIR, async () => {
    const dir = await pickDirectory(context.getMainWindow(), '选择游戏下载保存目录')
    if (!dir) return null
    logger.info('settings', `下载保存目录已修改：${dir}`)
    return settings.setDownloadDir(dir)
  })

  // EXE 还原：选 projector 封装的 EXE，按尾部页脚提取附加 SWF 并另存
  ipcMain.handle(IPC.EXE_UNPACK_SAVE, () => unpackSwfFromExeFile(context.getMainWindow()))

  // 外部链接：只允许 http/https，避免任意协议（file: / 自定义 scheme）被打开
  ipcMain.on(IPC.SHELL_OPEN_EXTERNAL, (_event, url: string) => {
    if (typeof url !== 'string' || !url) return
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return
    void shell.openExternal(parsed.href)
  })

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
