import type { RufflePlayerApi, RufflePlayerElement } from '@renderer/types/ruffle'

/**
 * Ruffle 运行时加载器。
 *
 * 加载顺序是正确性的关键：
 *   安装 WASM/时间补丁（core/runtime）→ 注入 ruffle.js → createPlayer。
 * 因此本模块绝不静态 import ruffle 资产，只做运行时按需注入。
 */

const RUFFLE_SCRIPT_ID = 'ruffle-runtime-script'

let loadPromise: Promise<void> | null = null

/** 设置全局播放器配置，必须在 ruffle.js 首次执行前调用 */
export function applyRuffleConfig(): void {
  const api: RufflePlayerApi = window.RufflePlayer ?? {}
  api.config = {
    autoplay: 'on',
    letterbox: 'on',
    unmuteOverlay: 'hidden',
    splashScreen: false,
    contextMenu: 'on',
    logLevel: 'error',
    maxExecutionDuration: 60,
    // 本工具面向本地单机游戏，禁用脚本访问降低风险
    allowScriptAccess: false,
    preferredRenderer: 'auto'
  }
  window.RufflePlayer = api
}

export function isRuffleReady(): boolean {
  return typeof window.RufflePlayer?.newest === 'function'
}
/** 确保 ruffle.js 已加载完成（幂等） */
export function ensureRuffleLoaded(): Promise<void> {
  if (isRuffleReady()) return Promise.resolve()
  if (loadPromise) return loadPromise

  applyRuffleConfig()
  const script = document.createElement('script')
  script.id = RUFFLE_SCRIPT_ID
  script.src = `${import.meta.env.BASE_URL}ruffle/ruffle.js`
  loadPromise = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener(
      'error',
      () => {
        loadPromise = null
        script.remove()
        reject(new Error('Ruffle 运行时加载失败，请检查安装是否完整'))
      },
      { once: true }
    )
  })
  document.head.appendChild(script)
  return loadPromise
}

/** 在容器中创建播放器元素 */
export async function createRufflePlayer(container: HTMLElement): Promise<RufflePlayerElement> {
  await ensureRuffleLoaded()
  const api = window.RufflePlayer
  if (!api?.newest) throw new Error('Ruffle 运行时不可用')
  const player = api.newest().createPlayer()
  container.appendChild(player)
  return player
}
