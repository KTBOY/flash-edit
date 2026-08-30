import { useEffect, useState } from 'react'
import { getApi } from '@renderer/services/ipc.service'

/**
 * 无边框窗口控制组：最小化 / 最大化-还原 / 关闭。
 * 内联 SVG 描边图标（stroke 2.2），关闭态 hover 红 —— 与原生标题栏心智一致。
 */

function MinGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  )
}

function MaxGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="miter">
      <rect x="5" y="5" width="14" height="14" />
    </svg>
  )
}

function RestoreGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M8.5 8.5V5H19v10.5h-3.5" />
      <rect x="5" y="8.5" width="10.5" height="10.5" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  )
}

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = getApi()
    void api.isWindowMaximized().then(setMaximized).catch(() => undefined)
    let unsubscribe: (() => void) | null = null
    try {
      unsubscribe = api.onWindowMaximized(setMaximized)
    } catch {
      // bridge 未就绪时忽略，保持默认图标
    }
    return () => unsubscribe?.()
  }, [])

  return (
    <div className="win-controls">
      <button type="button" aria-label="最小化" onClick={() => getApi().minimizeWindow()}>
        <MinGlyph />
      </button>
      <button
        type="button"
        aria-label={maximized ? '还原' : '最大化'}
        onClick={() => getApi().toggleMaximizeWindow()}
      >
        {maximized ? <RestoreGlyph /> : <MaxGlyph />}
      </button>
      <button type="button" className="close" aria-label="关闭" onClick={() => getApi().closeWindow()}>
        <CloseGlyph />
      </button>
    </div>
  )
}
