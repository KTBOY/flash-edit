import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 极简结构化日志：主进程统一前缀输出到控制台，并落盘到 userData/logs/app.log。
 * 打包版没有控制台，文件日志是排查"输出路径在哪"等问题的唯一入口；
 * 日志目录由 main 在应用就绪后注入（logger 自身不依赖 electron，可在单测环境使用）。
 */

const MAX_LOG_BYTES = 2 * 1024 * 1024

let logFile: string | null = null
let writeChain: Promise<void> = Promise.resolve()

/** 启用文件日志；超过 2MB 自动轮转为 app.old.log */
export function initFileLogging(dir: string): void {
  logFile = join(dir, 'app.log')
  writeChain = writeChain.then(async () => {
    await mkdir(dir, { recursive: true })
  }).catch(() => undefined)
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function emit(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  rest: unknown[]
): void {
  const detail = rest.length > 0 ? ` ${rest.map(formatValue).join(' ')}` : ''
  console[level === 'info' ? 'log' : level](`[flash-trainer][${scope}] ${message}`, ...rest)
  const target = logFile
  if (!target) return
  const line = `${new Date().toISOString()} [${level}][${scope}] ${message}${detail}`
  writeChain = writeChain
    .then(async () => {
      const size = await stat(target).then((s) => s.size, () => 0)
      if (size > MAX_LOG_BYTES) {
        await rename(target, target.replace(/\.log$/, '.old.log')).catch(() => undefined)
      }
      await appendFile(target, `${line}\n`, 'utf8')
    })
    .catch(() => undefined)
}

export const logger = {
  info(scope: string, message: string, ...rest: unknown[]): void {
    emit('info', scope, message, rest)
  },
  warn(scope: string, message: string, ...rest: unknown[]): void {
    emit('warn', scope, message, rest)
  },
  error(scope: string, message: string, ...rest: unknown[]): void {
    emit('error', scope, message, rest)
  }
}
