// oldswf 游戏资源实时补全器
//
// 用法：cd 到游戏目录，然后
//   SITE_BASE=https://oldswf.com/data/extra/<slug> node <项目>/scripts/mirror-fill.mjs
// 它会开一个真实浏览器指向本地 http://127.0.0.1:8765/ ，你正常玩；
// 游戏每请求一个本地不存在的资源（404），就立刻从 SITE_BASE 抓下来落盘，
// 所以玩到哪、缺什么、补什么，不用去猜文件名（站点目录不可枚举）。
//
// 前置：同目录先跑着 `node server.mjs`（Ruffle 不接受 file://）。
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SITE_BASE = (process.env.SITE_BASE || '').replace(/\/$/, '')
const LOCAL = process.env.LOCAL_URL || 'http://127.0.0.1:8765/'
const RUN_MS = Number(process.env.RUN_MS || 12 * 60 * 1000)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

if (!SITE_BASE) {
  console.error('缺少 SITE_BASE，例如 SITE_BASE=https://oldswf.com/data/extra/mxwsbcqwdb')
  process.exit(1)
}

const fetched = new Set()
const failed = new Set()

async function pull(pathname) {
  if (fetched.has(pathname) || failed.has(pathname)) return
  const url = SITE_BASE + pathname
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) {
      failed.add(pathname)
      console.log(`  站点也没有 ${res.status} ${pathname}`)
      return
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const out = join(ROOT, pathname.replace(/^\//, ''))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, buf)
    fetched.add(pathname)
    console.log(`  已补 ${pathname}（${(buf.length / 1024).toFixed(0)} KB）`)
  } catch (error) {
    failed.add(pathname)
    console.log(`  抓取失败 ${pathname}: ${error.message}`)
  }
}

console.log(`本地目录：${ROOT}`)
console.log(`站点目录：${SITE_BASE}`)
console.log(`浏览器窗口已打开，请在里面正常玩游戏；缺的资源会自动补。${RUN_MS / 60000} 分钟后自动结束。`)

const browser = await chromium.launch({ headless: false, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
page.on('response', (r) => {
  if (r.status() !== 404) return
  const pathname = decodeURIComponent(new URL(r.url()).pathname)
  if (pathname === '/favicon.ico') return
  console.log(`缺资源 → ${pathname}`)
  void pull(pathname)
})
page.on('close', () => {
  console.log('窗口被关闭，提前结束')
  browser.close().then(() => process.exit(0))
})

await page.goto(LOCAL, { waitUntil: 'load', timeout: 60000 })
await new Promise((r) => setTimeout(r, RUN_MS))
await browser.close()
console.log(`=== 本次共补 ${fetched.size} 个资源；站点也没有的 ${failed.size} 个 ===`)
