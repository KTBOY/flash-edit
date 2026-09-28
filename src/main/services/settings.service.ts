import { app } from 'electron'
import { join } from 'node:path'
import type { AppSettings } from '@shared/types'
import { JsonStore } from './storage.service'

/** 持久化结构：downloadDir 为空表示使用默认目录 */
interface PersistedSettings {
  downloadDir?: string
}

const EMPTY: () => PersistedSettings = () => ({})

/**
 * 应用设置持久化服务（当前仅管理游戏下载保存目录）。
 * 未自定义时下载目录回退到 userData/games。
 */
export class SettingsService {
  private readonly store: JsonStore<PersistedSettings>

  constructor(userDataDir: string) {
    this.store = new JsonStore<PersistedSettings>(join(userDataDir, 'data'), 'settings.json', EMPTY)
  }

  /** 默认下载目录：userData/games */
  defaultDownloadDir(): string {
    return join(app.getPath('userData'), 'games')
  }

  /** 当前生效的下载目录（已自定义或回退默认） */
  downloadDir(): string {
    return this.store.read().downloadDir || this.defaultDownloadDir()
  }

  /** 读取对外设置（downloadDir 始终为生效值，供渲染层直接展示） */
  get(): AppSettings {
    return { downloadDir: this.downloadDir() }
  }

  /** 设置下载目录并持久化 */
  setDownloadDir(dir: string): AppSettings {
    this.store.write({ ...this.store.read(), downloadDir: dir })
    return this.get()
  }
}
