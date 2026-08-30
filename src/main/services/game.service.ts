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

  remove(hash: string): void {
    const db = this.store.read()
    this.store.write({ version: 1, records: db.records.filter((r) => r.hash !== hash) })
  }
}

export function getUserDataDir(): string {
  return app.getPath('userData')
}
