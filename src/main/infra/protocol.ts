import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { logger } from './logger'

/**
 * swf-file:// 协议：让渲染进程以 fetch 的方式安全读取本地任意路径的 SWF。
 * URL 形如 swf-file://local/?p=<encodeURIComponent(绝对路径)>
 *
 * 必须在 app ready 之前调用 registerSchemesAsPrivileged。
 */
export const SWF_SCHEME = 'swf-file'

export function registerSwfSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SWF_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

export function buildSwfFileUrl(absolutePath: string): string {
  return `${SWF_SCHEME}://local/?p=${encodeURIComponent(absolutePath)}`
}

export function registerSwfProtocolHandler(): void {
  protocol.handle(SWF_SCHEME, async (request) => {
    try {
      const parsed = new URL(request.url)
      const filePath = parsed.searchParams.get('p')
      if (!filePath || !existsSync(filePath)) {
        return new Response('swf-file: 文件不存在或路径非法', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (error) {
      logger.error('protocol', 'swf-file 处理失败', error)
      return new Response('swf-file: 内部错误', { status: 500 })
    }
  })
}

/** 兜底：app 退出前注销协议处理器 */
export function disposeSwfProtocolHandler(): void {
  try {
    protocol.unhandle(SWF_SCHEME)
  } catch {
    // app 未 ready 或未注册时忽略
  }
}

