import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { App as AntdApp } from 'antd'
import { GameLauncher } from './game-launcher'
import { PlayerController } from '@renderer/core/ruffle/player-controller'

/**
 * 应用级服务容器：播放器控制器与游戏启动器为无状态 UI 之外的单例，
 * 通过 Context 注入，组件侧保持可测试（测试时可替换实现）。
 * 注意：本 Provider 必须位于 antd <App> 之内，以便注入 hook 版 message。
 */
export interface AppServices {
  controller: PlayerController
  launcher: GameLauncher
}

const AppServicesContext = createContext<AppServices | null>(null)

export function AppServicesProvider({ children }: { children: ReactNode }) {
  const { message } = AntdApp.useApp()
  const services = useMemo<AppServices>(() => {
    const controller = new PlayerController()
    const launcher = new GameLauncher(controller, message)
    return { controller, launcher }
  }, [message])
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext)
  if (!services) throw new Error('useAppServices 必须在 AppServicesProvider 内使用')
  return services
}
