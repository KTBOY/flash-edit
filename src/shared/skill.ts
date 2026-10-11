import type { SkillItem } from './types'

/** SKILL.md 正文读取上限（字节）：面板只做预览，超出即截断，避免整份大文件穿过 IPC */
export const SKILL_BODY_LIMIT = 64 * 1024

export interface SkillDoc {
  /** frontmatter name，缺失时退回正文首个标题，再退回目录名 */
  name: string
  /** frontmatter description，缺失时退回正文首段 */
  description: string
  /** frontmatter 之后的正文 */
  body: string
}

/** 用码位构造而非字面量，避免源码里出现不可见字符 */
const BOM_PATTERN = new RegExp('^' + String.fromCharCode(0xfeff))

/**
 * 解析 SKILL.md。
 *
 * 只认 frontmatter 里零缩进的 `key: value`（含引号包裹与缩进续行折叠），不引入 YAML 库；
 * 描述里带冒号、破折号、中文都很常见，因此只在第一个冒号处切分。
 */
export function parseSkillDoc(raw: string, fallbackName: string): SkillDoc {
  const lines = raw.replace(BOM_PATTERN, '').split(/\r\n|\r|\n/)
  if (lines[0]?.trim() !== '---') return fromBody(lines, fallbackName)
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line))
  if (end < 0) return fromBody(lines.slice(1), fallbackName)
  const fields = readFrontmatter(lines.slice(1, end))
  const rest = lines.slice(end + 1)
  const body = rest.join('\n').trim()
  return {
    name: fields.name || headingTitle(rest) || fallbackName,
    description: fields.description || firstParagraph(rest),
    body
  }
}

function readFrontmatter(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {}
  let key: string | null = null
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const head = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (head && !/^\s/.test(line)) {
      key = head[1].toLowerCase()
      fields[key] = cleanScalar(head[2])
      continue
    }
    // 缩进续行 / 列表项：折进上一个键，保住多行描述的完整语义
    if (key && /^\s+\S/.test(line)) {
      const extra = cleanScalar(line.trim().replace(/^-\s*/, ''))
      if (extra) fields[key] = `${fields[key]} ${extra}`.trim()
    }
  }
  return fields
}

function cleanScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '|' || trimmed === '>' || trimmed === '|-' || trimmed === '>-') return ''
  const quoted = /^(["'])(.*)\1\s*$/.exec(trimmed)
  return quoted ? quoted[2].trim() : trimmed
}

function fromBody(lines: string[], fallbackName: string): SkillDoc {
  return {
    name: headingTitle(lines) || fallbackName,
    description: firstParagraph(lines),
    body: lines.join('\n').trim()
  }
}

function headingTitle(lines: string[]): string {
  for (const line of lines) {
    const matched = /^#{1,3}\s+(.+?)\s*#*$/.exec(line.trim())
    if (matched) return matched[1].trim()
  }
  return ''
}

function firstParagraph(lines: string[]): string {
  let text = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (text) break
      continue
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('```') || trimmed.startsWith('|')) {
      if (text) break
      continue
    }
    text = `${text} ${trimmed}`.trim()
    if (text.length > 400) break
  }
  return text
}

/** 同名 skill 落在多个扫描根时的标记；谁生效由 Qoder 决定，界面只提示不裁决 */
export function markDuplicateNames(items: SkillItem[]): SkillItem[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  return items.map((item) => ({ ...item, duplicated: (counts.get(item.name) ?? 0) > 1 }))
}

/** 同名条目相邻排列，让重复一眼可见 */
export function sortSkillItems(items: SkillItem[]): SkillItem[] {
  return [...items].sort(
    (a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root)
  )
}
