// 运行时单例必须最先导入：在 Ruffle 加载前完成 WebAssembly 与时间函数补丁
import '@renderer/core/runtime'
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/styles/global.css'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('未找到 #root 挂载点')

createRoot(container).render(<App />)

/**
 * 首屏骨架收尾。
 *
 * 骨架是 index.html 里的静态节点（#root 的兄弟），用来盖住 React 挂载 +
 * antd cssinjs 运行时注入样式这段空窗期，消除启动时的白闪与卡顿观感。
 *
 * 用双 rAF 而不是单个：第一帧保证 React 已提交 DOM，第二帧保证样式注入完成
 * 且浏览器已完成一次绘制，此时再淡出，才不会出现「骨架消失但 UI 还没画好」。
 *
 * 任何异常都必须兜底移除，否则骨架会永久遮挡界面。
 */
function dismissBoot(): void {
  const boot = document.getElementById('boot')
  if (!boot) return
  const remove = (): void => boot.remove()
  try {
    boot.classList.add('boot-done')
    window.setTimeout(remove, 300)
  } catch {
    remove()
  }
}

requestAnimationFrame(() => requestAnimationFrame(dismissBoot))
