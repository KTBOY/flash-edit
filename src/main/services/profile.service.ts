import { join } from 'node:path'
import type { CheatProfile } from '@shared/types'
import { JsonStore } from './storage.service'

interface ProfilesDb {
  version: 1
  profiles: Record<string, CheatProfile>
}

const EMPTY: () => ProfilesDb = () => ({ version: 1, profiles: {} })

/** 按游戏哈希保存的修改配置服务 */
export class ProfileService {
  private readonly store: JsonStore<ProfilesDb>

  constructor(userDataDir: string) {
    this.store = new JsonStore<ProfilesDb>(join(userDataDir, 'data'), 'profiles.json', EMPTY)
  }

  list(): string[] {
    return Object.keys(this.store.read().profiles)
  }

  load(gameHash: string): CheatProfile | null {
    return this.store.read().profiles[gameHash] ?? null
  }

  save(profile: CheatProfile): void {
    const db = this.store.read()
    db.profiles[profile.gameHash] = { ...profile, updatedAt: new Date().toISOString() }
    this.store.write(db)
  }

  remove(gameHash: string): void {
    const db = this.store.read()
    delete db.profiles[gameHash]
    this.store.write(db)
  }
}
