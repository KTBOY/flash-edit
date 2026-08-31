import type { MessageArgsProps } from 'antd'
import type { ReactNode } from 'react'

/**
 * 统一消息出口类型：与 antd <App> 钩子实例（App.useApp().message）结构兼容，
 * 供组件外的服务（如 GameLauncher）注入使用，避免静态 message 游离于主题与 holder 之外。
 */
export interface UiMessageApi {
  success(content: ReactNode | MessageArgsProps): void
  info(content: ReactNode | MessageArgsProps): void
  warning(content: ReactNode | MessageArgsProps): void
  error(content: ReactNode | MessageArgsProps): void
}

/**
 * 生成"必然自动消失"的消息配置。
 * rc-notification 的 Notice 默认悬停暂停关闭计时（pauseOnHover=true）并用 Date.now 记账，
 * 原生对话框/游戏加载等场景下 hover 状态可能滞留，计时器被清除后不再重置 → 消息永不消失；
 * 关闭悬停暂停 + 显式 duration 保证到点即消。
 */
export function toast(content: ReactNode, duration = 3): MessageArgsProps {
  return { content, duration, pauseOnHover: false } as MessageArgsProps
}
