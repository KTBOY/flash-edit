import { app } from 'electron'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { markDuplicateNames, parseSkillDoc, SKILL_BODY_LIMIT, sortSkillItems } from '@shared/skill'
import type { SkillItem, SkillMarkdownResult } from '@shared/types'
import { isInsideDir } from '../infra/paths'
import { logger } from '../infra/logger'

const FILE_NAME = 'SKILL.md'

/** 项目内的 skill 存放约定：`.agents\skills\` 为本仓库使用的那套，`.qoder\skills\` 一并兼容 */
const PROJECT_SKILL_DIRS = ['.agents', '.qoder']

/**
 * 当前项目的 Agent Skill 扫描。
 *
 * 只看项目自己：开发时取仓库根，打包安装后取 exe 同级目录（没有该目录就不显示）。
 * 单个 SKILL.md 读坏只跳过一条，不会让面板空掉。
 */
export class SkillService {
  async list(): Promise<SkillItem[]> {
    const items: SkillItem[] = []
    for (const root of projectRoots()) {
      for (const dir of await skillDirsOf(root)) {
        const item = await readItem(root, dir)
        if (item) items.push(item)
      }
    }
    const sorted = sortSkillItems(markDuplicateNames(items))
    logger.info('skill', `扫描到 ${sorted.length} 个项目 skill`)
    return sorted
  }

  /** 只放行位于项目扫描根内的 SKILL.md，避免这条通道变成任意文件读取 */
  async read(path: string): Promise<SkillMarkdownResult | null> {
    if (typeof path !== 'string' || !path.endsWith(FILE_NAME)) return null
    const roots = projectRoots()
    const target = resolve(path)
    if (!roots.some((root) => isInsideDir(target, root))) return null
    try {
      const doc = parseSkillDoc(await readFile(target, 'utf-8'), basename(dirname(target)))
      const truncated = Buffer.byteLength(doc.body, 'utf-8') > SKILL_BODY_LIMIT
      return { body: truncated ? doc.body.slice(0, SKILL_BODY_LIMIT) : doc.body, truncated }
    } catch {
      return null
    }
  }
}

function projectRoots(): string[] {
  const base = app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
  return PROJECT_SKILL_DIRS.map((dir) => join(base, dir, 'skills'))
}

async function skillDirsOf(root: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
}

async function readItem(root: string, dir: string): Promise<SkillItem | null> {
  const file = join(dir, FILE_NAME)
  try {
    const info = await stat(file)
    if (!info.isFile()) return null
    const doc = parseSkillDoc(await readFile(file, 'utf-8'), basename(dir))
    return {
      path: file,
      dir,
      name: doc.name || basename(dir),
      description: doc.description,
      root,
      sizeBytes: info.size,
      updatedAt: info.mtimeMs,
      duplicated: false
    }
  } catch (error) {
    logger.warn('skill', `跳过 ${file}：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
