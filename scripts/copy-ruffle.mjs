// 将 @ruffle-rs/ruffle 的运行时资产复制到 renderer public 目录，
// 供 index.html 同源加载（file:// 协议下必须使用相对路径资产）。
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, 'node_modules/@ruffle-rs/ruffle')
const dest = resolve(root, 'src/renderer/public/ruffle')

if (!existsSync(src)) {
  console.warn('[copy-ruffle] @ruffle-rs/ruffle 未安装，跳过复制（请先 npm install）')
  process.exit(0)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`[copy-ruffle] 已复制 Ruffle 运行时到 ${dest}`)
