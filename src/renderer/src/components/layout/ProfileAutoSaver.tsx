import { useEffect } from 'react'
import { App as AntdApp } from 'antd'
import { getApi } from '@renderer/services/ipc.service'
import { useCheatStore } from '@renderer/store/useCheatStore'
import { useGameStore } from '@renderer/store/useGameStore'

/**
 * 修改配置自动保存（防抖 800ms；speed 一并持久化）。
 *
 * 刻意从 AppShell 中抽出来：这里订阅了 speed，而变速滑块的 onChange 是高频的。
 * 若把这层订阅留在 AppShell，滑块每动一帧都会重渲染整棵树（含 Tabs），
 * rc-tabs 会反复重新测量几何，表现为 Tab 栏下划线滑动、Tab 行跳位。
 * 抽成不渲染任何内容的组件后，速度变化只影响本组件与设置面板。
 */
export default function ProfileAutoSaver() {
  const { message } = AntdApp.useApp()
  const entries = useCheatStore((s) => s.entries)
  const gameHash = useCheatStore((s) => s.gameHash)
  const speed = useGameStore((s) => s.speed)

  useEffect(() => {
    if (!gameHash) return
    const timer = setTimeout(() => {
      const profile = useCheatStore.getState().buildProfile()
      if (!profile) return
      getApi()
        .saveProfile(profile)
        .catch(() => message.warning('修改配置自动保存失败'))
    }, 800)
    return () => clearTimeout(timer)
  }, [entries, gameHash, speed, message])

  return null
}
