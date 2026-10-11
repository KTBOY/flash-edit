import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { resolveSwfFileUrl } from '@shared/protocol'
import { isInsideDir } from './paths'
import { logger } from './logger'

/**
 * swf-file:// 协议：让渲染进程以 fetch 的方式安全读取本地任意路径的 SWF。
 * URL 形如 swf-file://local/C%3A/Users/…/games/play.swf（逐段编码，保留 / 分隔），
 * 因此 SWF 内对同目录文件的相对请求能按标准 URL 规则解析。
 *
 * 必须在 app ready 之前调用 registerSchemesAsPrivileged。
 */
export const SWF_SCHEME = 'swf-file'

/**
 * 已服务过 .swf/.spl 的目录，作为附属文件（关卡、shell.xml 等）的允许根。
 * 渲染进程总是先请求游戏本体再请求兄弟文件，所以正常流程一定命中；
 * 而 `../` 越界拿到的路径落在所有根之外，会被拒掉。
 */
const gameDirs = new Set<string>()
const MAX_GAME_DIRS = 32

function isSwfPath(filePath: string): boolean {
  return /\.(swf|spl)$/i.test(filePath)
}

function allowSiblingAccess(filePath: string): boolean {
  for (const dir of gameDirs) if (isInsideDir(filePath, dir)) return true
  return false
}

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

export function registerSwfProtocolHandler(): void {
  protocol.handle(SWF_SCHEME, async (request) => {
    try {
      const filePath = resolveSwfFileUrl(request.url)
      if (!filePath || !isAbsolute(filePath) || !existsSync(filePath)) {
        return new Response('swf-file: 文件不存在或路径非法', { status: 404 })
      }
      if (isSwfPath(filePath)) {
        if (gameDirs.size >= MAX_GAME_DIRS) {
          const oldest = gameDirs.values().next().value
          if (oldest !== undefined) gameDirs.delete(oldest)
        }
        gameDirs.add(resolve(dirname(filePath)))
      } else if (!allowSiblingAccess(filePath)) {
        logger.warn('protocol', `swf-file 拒绝游戏目录之外的读取：${filePath}`)
        return new Response('swf-file: 不允许访问该路径', { status: 403 })
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
  gameDirs.clear()
  try {
    protocol.unhandle(SWF_SCHEME)
  } catch {
    // app 未 ready 或未注册时忽略
  }
}

