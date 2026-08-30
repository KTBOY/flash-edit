/** 极简结构化日志：主进程统一前缀输出，避免散落 console */
export const logger = {
  info(scope: string, message: string, ...rest: unknown[]): void {
    console.log(`[flash-trainer][${scope}] ${message}`, ...rest)
  },
  warn(scope: string, message: string, ...rest: unknown[]): void {
    console.warn(`[flash-trainer][${scope}] ${message}`, ...rest)
  },
  error(scope: string, message: string, ...rest: unknown[]): void {
    console.error(`[flash-trainer][${scope}] ${message}`, ...rest)
  }
}
