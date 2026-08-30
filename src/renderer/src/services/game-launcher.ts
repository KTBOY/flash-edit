import { message } from 'antd'
import type { GameRecord } from '@shared/types'
import { buildSwfFileUrl } from '@shared/protocol'
import { timeScaler } from '@renderer/core/runtime'
import { sha256Hex, sha256HexOfString } from '@renderer/core/hash'
import { getApi } from './ipc.service'
import type { PlayerController } from '@renderer/core/ruffle/player-controller'
import { useCheatStore } from '@renderer/store/useCheatStore'
import { useGameStore } from '@renderer/store/useGameStore'
import { useScanStore } from '@renderer/store/useScanStore'

/**
 * 游戏启动编排服务：文件选择 / 拖拽 / URL / 游戏库重开 四条入口统一走
 * loadWithSource → finalize：扫描会话重置 → 修改列表切换 → 播放器加载
 * → 游戏库记录 → 修改配置恢复（含速度）。
 */

/** 当前会话加载的 SWF 源字节（供"写入 SWF"离线补丁使用；URL 来源为 null） */
let loadedSwfSource: { bytes: Uint8Array; name: string } | null = null

export function getLoadedSwfSource(): { bytes: Uint8Array; name: string } | null {
  return loadedSwfSource
}

export class GameLauncher {
  constructor(private readonly controller: PlayerController) {}

  /** 弹出系统对话框选择并加载 */
  async loadPickedFile(): Promise<void> {
    try {
      const picked = await getApi().pickSwfFile()
      if (!picked) return
      await this.loadLocalPath(picked.path, picked.name, picked.size)
    } catch (error) {
      this.fail('选择文件失败', error)
    }
  }

  /** 处理拖拽进入的文件 */
  async loadDroppedFile(file: File): Promise<void> {
    if (!/\.(swf|spl)$/i.test(file.name)) {
      message.warning('仅支持 .swf / .spl 文件')
      return
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await this.loadWithBytes(bytes, file.name, bytes.byteLength, 'drop')
    } catch (error) {
      this.fail('读取拖拽文件失败', error)
    }
  }

  /** 从远程 URL 加载（需目标服务器允许跨域） */
  async loadFromUrl(url: string): Promise<void> {
    const normalized = url.trim()
    if (!/^https?:\/\//i.test(normalized)) {
      message.error('请输入 http(s):// 开头的 SWF 地址')
      return
    }
    useGameStore.getState().beginLoad()
    loadedSwfSource = null // 远程来源无本地字节，不支持离线补丁
    try {
      const hash = `url:${await sha256HexOfString(normalized)}`
      const name = filenameFromUrl(normalized) ?? normalized
      await this.controller.load({ name, url: normalized })
      await this.finalize({ hash, name, size: 0, source: 'url', url: normalized })
    } catch (error) {
      this.fail('加载远程 SWF 失败（可能被 CORS 拦截）', error)
    }
  }

  /** 从游戏库记录重新打开 */
  async reopen(record: GameRecord): Promise<void> {
    if (record.source === 'url' && record.url) {
      return this.loadFromUrl(record.url)
    }
    if (record.path) {
      return this.loadLocalPath(record.path, record.name, record.size)
    }
    message.warning('该记录来自拖拽加载，未保存本地路径，请重新拖入文件')
  }

  /** 载入 oldswf 下载完成的本地文件（游戏库记录保留 download 来源） */
  async loadDownloadedFile(result: {
    path: string
    name: string
    sizeBytes: number
  }): Promise<void> {
    await this.loadLocalPath(result.path, result.name, result.sizeBytes, 'download')
  }

  /** 载入指定路径的本地 SWF（EXE 还原等流程用；来源按普通文件记录） */
  async loadLocalFile(path: string, name: string, size: number): Promise<void> {
    await this.loadLocalPath(path, name, size)
  }

  private async loadLocalPath(
    path: string,
    name: string,
    size: number,
    source: GameRecord['source'] = 'file'
  ): Promise<void> {
    useGameStore.getState().beginLoad()
    try {
      const response = await fetch(buildSwfFileUrl(path))
      if (!response.ok) throw new Error(`本地文件读取失败（HTTP ${response.status}）`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      await this.loadWithBytes(bytes, name, size, source, path)
    } catch (error) {
      this.fail('加载本地 SWF 失败', error)
    }
  }

  private async loadWithBytes(
    bytes: Uint8Array,
    name: string,
    size: number,
    source: GameRecord['source'],
    path?: string
  ): Promise<void> {
    useGameStore.getState().beginLoad()
    try {
      const hash = await sha256Hex(bytes)
      loadedSwfSource = { bytes, name }
      await this.controller.load({ name, data: bytes })
      await this.finalize({ hash, name, size, source, path })
    } catch (error) {
      this.fail('加载 SWF 失败', error)
    }
  }

  private async finalize(context: {
    hash: string
    name: string
    size: number
    source: GameRecord['source']
    path?: string
    url?: string
  }): Promise<void> {
    // 1. 重置扫描会话：地址对新游戏无意义
    useScanStore.getState().resetScan()
    // 2. 切换修改列表上下文
    useCheatStore.getState().switchGame(context.hash, context.name)
    // 3. 更新游戏状态并记录到游戏库
    useGameStore.getState().completeLoad({
      hash: context.hash,
      name: context.name,
      size: context.size,
      source: context.source
    })
    const record: GameRecord = { ...context, lastPlayed: new Date().toISOString() }
    void getApi()
      .addRecentGame(record)
      .then(() => useGameStore.getState().refreshRecent())
      .catch(() => undefined)

    // 4. 恢复该游戏的修改配置
    try {
      const profile = await getApi().loadProfile(context.hash)
      if (profile && profile.entries.length > 0) {
        const { restored, stale } = useCheatStore.getState().applyProfile(profile)
        if (profile.speed > 0 && profile.speed !== 1) {
          timeScaler.setSpeed(profile.speed)
          useGameStore.getState().setSpeed(profile.speed)
        }
        if (stale > 0) {
          message.info(`已恢复 ${restored} 条修改，其中 ${stale} 条地址失效已停用`)
        } else {
          message.success(`已恢复 ${restored} 条修改`)
        }
      }
    } catch {
      // 配置恢复失败不影响游戏加载
    }
  }

  private fail(prefix: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error)
    message.error(`${prefix}：${detail}`)
    useGameStore.getState().failLoad(`${prefix}：${detail}`)
  }
}

function filenameFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const name = decodeURIComponent(pathname.split('/').pop() ?? '')
    return name || null
  } catch {
    return null
  }
}
