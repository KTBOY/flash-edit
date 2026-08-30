import type { IpcApi } from '@shared/ipc'

/** 获取 preload 注入的 IPC API。未就绪时抛出明确错误，便于排查加载时序问题 */
export function getApi(): IpcApi {
  const api = (window as unknown as { api?: IpcApi }).api
  if (!api) {
    throw new Error('IPC bridge 未就绪（preload 未加载）')
  }
  return api
}
