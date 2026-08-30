import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../infra/logger'

/**
 * 原子写入的 JSON 持久化存储。
 * 写入策略：先写临时文件，再 rename 覆盖，避免崩溃导致数据损坏。
 */
export class JsonStore<T> {
  private readonly filePath: string
  private cache: T | null = null

  constructor(dir: string, fileName: string, private readonly fallback: () => T) {
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, fileName)
  }

  read(): T {
    if (this.cache !== null) return this.cache
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      this.cache = JSON.parse(raw) as T
    } catch {
      this.cache = this.fallback()
    }
    return this.cache
  }

  write(value: T): void {
    this.cache = value
    try {
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
      renameSync(tmp, this.filePath)
    } catch (error) {
      logger.error('storage', `写入 ${this.filePath} 失败`, error)
    }
  }
}
