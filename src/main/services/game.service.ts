import { app } from 'electron'
import { join } from 'node:path'
import type { GameRecord } from '@shared/types'
import { JsonStore } from './storage.service'

interface GamesDb {
  version: 1
  records: GameRecord[]
}

const EMPTY: () => GamesDb = () => ({ version: 1, records: [] })
const MAX_RECORDS = 50

/** 游戏库（最近游玩）持久化服务 */
export class GameService {
  private readonly store: JsonStore<GamesDb>

  constructor(userDataDir: string) {
    this.store = new JsonStore<GamesDb>(join(userDataDir, 'data'), 'games.json', EMPTY)
  }

  list(): GameRecord[] {
    return [...this.store.read().records].sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))
  }

  upsert(record: GameRecord): void {
    const db = this.store.read()
    const next = db.records.filter((r) => r.hash !== record.hash)
    next.push(record)
    next.sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))
    this.store.write({ version: 1, records: next.slice(0, MAX_RECORDS) })
  }

  /** 批量移除记录，返回被移除的记录（IPC 层据此判断哪些文件属于本应用下载） */
  removeMany(hashes: string[]): GameRecord[] {
    const target = new Set(hashes)
    const db = this.store.read()
    const removed = db.records.filter((r) => target.has(r.hash))
    if (removed.length > 0) {
      this.store.write({ version: 1, records: db.records.filter((r) => !target.has(r.hash)) })
    }
    return removed
  }
}

export function getUserDataDir(): string {
  return app.getPath('userData')
}
