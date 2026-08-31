// 从 resources/icon.svg 生成应用图标资产：
//   resources/icon.png（256，窗口图标）
//   resources/icon.ico（256/48/32/16 多尺寸 PNG 封装，electron-builder 打包用）
// 渲染走 headless Edge + CDP（本机无其他光栅化工具链）。
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const USER_DATA = join(process.env['TEMP'] ?? '/tmp', 'flash-icon-profile')
const ASSET_URL =
  'file:///' + join(ROOT, 'docs/mockups/app-icon.html').replace(/\\/g, '/')

const ICO_SIZES = [256, 48, 32, 16]

const browser = spawn(EDGE, [
  '--headless=new',
  '--remote-debugging-port=9224',
  `--user-data-dir=${USER_DATA}`,
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank'
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForCDP() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9224/json/version')
      if (res.ok) return
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP 端口未就绪')
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map() }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function renderSize(cdp, size) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: size, height: size, deviceScaleFactor: 1, mobile: false
  })
  await cdp.send('Page.navigate', { url: `${ASSET_URL}?asset=${size}` })
  await sleep(500)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  return Buffer.from(shot.data, 'base64')
}

/** 多尺寸 PNG 封装 ICO（Vista 起支持 PNG 编码条目） */
function buildIco(images) {
  const headerSize = 6 + 16 * images.length
  const dir = Buffer.alloc(headerSize)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(images.length, 4)

  let offset = headerSize
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, e)
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1)
    dir.writeUInt8(0, e + 2)
    dir.writeUInt8(0, e + 3)
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(png.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([dir, ...images.map((im) => im.png)])
}

try {
  await waitForCDP()
  const targets = await fetch('http://127.0.0.1:9224/json').then((r) => r.json())
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  const cdp = new CDP(ws)
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && cdp.pending.has(msg.id)) {
      const { resolve, reject } = cdp.pending.get(msg.id)
      cdp.pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  await cdp.send('Page.enable')

  const png256 = await renderSize(cdp, 256)
  writeFileSync(join(ROOT, 'resources/icon.png'), png256)
  console.log('saved: resources/icon.png (256)')

  const images = [{ size: 256, png: png256 }]
  for (const size of ICO_SIZES.slice(1)) {
    images.push({ size, png: await renderSize(cdp, size) })
  }
  writeFileSync(join(ROOT, 'resources/icon.ico'), buildIco(images))
  console.log('saved: resources/icon.ico', ICO_SIZES.join('/'))
  ws.close()
} catch (e) {
  console.error('FAIL:', e.message)
  process.exitCode = 1
} finally {
  browser.kill()
}
