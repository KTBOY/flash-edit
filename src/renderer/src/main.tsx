// 运行时单例必须最先导入：在 Ruffle 加载前完成 WebAssembly 与时间函数补丁
import '@renderer/core/runtime'
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/styles/global.css'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('未找到 #root 挂载点')

createRoot(container).render(<App />)
