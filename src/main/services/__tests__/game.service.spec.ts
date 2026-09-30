import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GameRecord } from '@shared/types'
import { GameService } from '../game.service'

describe('GameService.rename', () => {
  let dir: string
  let service: GameService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'games-db-'))
    service = new GameService(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const record = (hash: string, name: string): GameRecord => ({
    hash,
    name,
    size: 1024,
    lastPlayed: '2026-01-01T00:00:00.000Z',
    source: 'download',
    path: join(dir, 'games', `${hash}.swf`)
  })

  it('修改指定记录的显示名，其余字段原样保留', () => {
    service.upsert(record('a', '旧名字'))
    service.upsert(record('b', '另一个'))
    expect(service.rename('a', '新名字')).toBe(true)
    const renamed = service.list().find((r) => r.hash === 'a')
    expect(renamed?.name).toBe('新名字')
    expect(renamed?.path).toBe(record('a', '旧名字').path)
    expect(service.list().find((r) => r.hash === 'b')?.name).toBe('另一个')
  })

  it('对不存在的记录返回 false 且不改库', () => {
    service.upsert(record('a', '旧名字'))
    expect(service.rename('nope', '新名字')).toBe(false)
    expect(service.list()).toHaveLength(1)
    expect(service.list()[0]?.name).toBe('旧名字')
  })

  it('重命名结果持久化，重建服务后仍可读到', () => {
    service.upsert(record('a', '旧名字'))
    service.rename('a', '新名字')
    const reopened = new GameService(dir)
    expect(reopened.list().find((r) => r.hash === 'a')?.name).toBe('新名字')
  })
})
