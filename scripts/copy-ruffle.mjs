// 将 @ruffle-rs/ruffle 的运行时资产复制到 renderer public 目录，
// 供 index.html 同源加载（file:// 协议下必须使用相对路径资产）。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/@ruffle-rs/ruffle')
const dest = resolve(root, 'src/renderer/public/ruffle')

// ruffle.js 按运行时 WebAssembly 特性检测二选一加载核心：
//   全部支持（Chromium 90+ 恒真，本应用为 Electron 37）→ core.ruffle.15317…js + 6ce4f6…wasm
//   任一缺失 → 降级 core.ruffle.5e30d…js + a71cef…wasm（约 14MB，永远走不到，不复制）
const VANILLA_FALLBACK_FILES = new Set([
  'core.ruffle.5e30dc5777a75720eae2.js',
  'a71cef02d58dcec6f55f.wasm'
])

// sourcemap 仅调试用，打包体积敏感；降级核心按上表剔除。
// 升级 @ruffle-rs/ruffle 版本后如需重新甄别，见 ruffle.js 中
// `n ? a.e(655) : a.e(482)` 的特性检测与核心分块映射。
if (!existsSync(src)) {
  console.warn('[copy-ruffle] @ruffle-rs/ruffle 未安装，跳过复制（请先 npm install）')
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
// 只清空内容、不删目录本身：Windows 上目录句柄被占用（资源管理器/杀软/索引器）
// 时 rmSync(目录) 会 EBUSY/EPERM，而子项照常可删
for (const entry of readdirSync(dest)) {
  rmSync(join(dest, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
cpSync(src, dest, {
  recursive: true,
  filter: (source) => {
    const name = source.split(/[\\/]/).pop() ?? ''
    return !name.endsWith('.map') && !VANILLA_FALLBACK_FILES.has(name)
  }
})
console.log(`[copy-ruffle] 已复制 Ruffle 运行时到 ${dest}`)
