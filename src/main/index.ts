import { BrowserWindow, Menu, app, screen } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc-register'
import { logger } from './infra/logger'
import { disposeSwfProtocolHandler, registerSwfProtocolHandler, registerSwfSchemePrivileges } from './infra/protocol'

/**
 * 主进程入口：协议注册 → 窗口创建 → IPC 装配。
 * 本应用加载的内容全部为本地/用户自选资源，保持 Electron 默认安全配置
 * （contextIsolation + sandbox），仅通过 preload 暴露最小 IPC 面。
 */

let mainWindow: BrowserWindow | null = null

function createMainWindow(): BrowserWindow {
  // 默认尺寸按屏幕工作区收窄，小屏不溢出
  const { width: areaW, height: areaH } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: Math.min(1500, areaW),
    height: Math.min(940, areaH),
    minWidth: 1180,
    minHeight: 720,
    show: false,
    // 无边框窗口：原生标题栏移除，由渲染层 hud-header 承担拖拽与窗口控制
    frame: false,
    backgroundColor: '#14161a',
    title: 'Flash Game Trainer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 阻止页面请求打开新窗口
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  registerSwfSchemePrivileges()

  app.whenReady().then(() => {
    registerSwfProtocolHandler()
    const isDev = !app.isPackaged
    if (!isDev) Menu.setApplicationMenu(null)

    mainWindow = createMainWindow()
    registerIpcHandlers({ getMainWindow: () => mainWindow })
    logger.info('main', '应用已就绪', { version: app.getVersion() })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    disposeSwfProtocolHandler()
    if (process.platform !== 'darwin') app.quit()
  })
}
