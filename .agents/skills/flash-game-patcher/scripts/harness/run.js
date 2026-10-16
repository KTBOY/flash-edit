#!/usr/bin/env node
/**
 * run.js —— Ruffle + Playwright 自动化测试驱动（轨迹点击 / 截图 / 跨会话存档验证）。
 *
 * 依赖本项目自带的 playwright-core（驱动系统 Edge）：
 *   NODE_PATH="<repo>/node_modules" node run.js --url http://127.0.0.1:8321/index.html --script clicks.json
 *
 * 命令行：
 *   --url <url>            测试页地址（默认 http://127.0.0.1:8321/index.html）
 *   --script <file.json>   动作脚本（见下），缺省只做"加载+等待+截图"
 *   --outdir <dir>         截图与日志输出目录（默认 ./_run）
 *   --wait <ms>            加载后等待时长（默认 45000；三层包装 SWF 需 40~45s）
 *   --user-data <dir>      给定则用 launchPersistentContext（跨会话存档测试）
 *   --channel <name>       浏览器通道（默认 msedge）
 *   --headful              有头模式（默认有头，便于观察）
 *
 * 动作脚本 clicks.json 格式（数组，按顺序执行）：
 *   [
 *     { "type": "click", "x": 320, "y": 220, "fromY": 180, "times": 1 },
 *     { "type": "wait",  "ms": 800 },
 *     { "type": "shot",  "name": "after_start" },
 *     { "type": "eval",  "expr": "localStorage.length" },
 *     { "type": "dumpStorage" }
 *   ]
 *   x/y 为**页面坐标**（= 舞台坐标 + 画布偏移；本 harness 偏移 (30,0)）。
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const URL_ = arg('url', 'http://127.0.0.1:8321/index.html');
const SCRIPT = arg('script', null);
const OUTDIR = path.resolve(arg('outdir', './_run'));
const WAIT = parseInt(arg('wait', '45000'), 10);
const USER_DATA = arg('user-data', null);
const CHANNEL = arg('channel', 'msedge');

fs.mkdirSync(OUTDIR, { recursive: true });

// playwright-core 来自本项目 node_modules（用 NODE_PATH 指定）
let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (e) {
  console.error('找不到 playwright-core。请设 NODE_PATH 指向本仓库 node_modules，例如：');
  console.error('  NODE_PATH="D:/my/flash-edit/node_modules" node run.js ...');
  process.exit(2);
}

/** 轨迹式点击：模拟真实鼠标"移入→停顿→按下→抬起"。
 *  page.mouse.click() 的直接瞬移点击在 Ruffle 中大概率不触发（悬停态未建立）。 */
async function trailClick(page, x, y, fromY) {
  const y0 = (fromY == null) ? Math.max(40, y - 20) : fromY;
  for (let yy = y0; yy <= y; yy += 6) {
    await page.mouse.move(x, yy);
    await page.waitForTimeout(30);
  }
  await page.mouse.move(x, y);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
}

(async () => {
  const logs = [];
  const launchOpts = { channel: CHANNEL, headless: false, args: ['--disable-gpu'] };
  let context, browser;
  if (USER_DATA) {
    context = await chromium.launchPersistentContext(USER_DATA, launchOpts);
    browser = null;
  } else {
    browser = await chromium.launch(launchOpts);
    context = await browser.newContext({ viewport: { width: 700, height: 540 } });
  }
  const pages = context.pages();
  const page = pages.length ? pages[0] : await context.newPage();

  page.on('console', (m) => {
    const t = m.text();
    logs.push('[console] ' + t.slice(0, 300));
    if (/error|warn/i.test(m.type())) console.log('[console:' + m.type() + ']', t.slice(0, 300));
  });
  page.on('pageerror', (e) => {
    logs.push('[pageerror] ' + String(e).slice(0, 300));
    console.log('[pageerror]', String(e).slice(0, 300));
  });

  console.log('打开', URL_);
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  console.log('等待 SWF 加载 ' + WAIT + 'ms ...');
  await page.waitForTimeout(WAIT);
  await page.screenshot({ path: path.join(OUTDIR, 'loaded.png') });

  // 步进执行动作脚本
  if (SCRIPT) {
    const steps = JSON.parse(fs.readFileSync(SCRIPT, 'utf-8'));
    let shotIdx = 0;
    for (const s of steps) {
      if (s.type === 'click') {
        const times = s.times || 1;
        for (let k = 0; k < times; k++) {
          await trailClick(page, s.x, s.y, s.fromY);
          await page.waitForTimeout(s.after || 400);
        }
        console.log('click', s.x, s.y, 'x' + times);
      } else if (s.type === 'wait') {
        await page.waitForTimeout(s.ms || 500);
      } else if (s.type === 'shot') {
        const name = (s.name || ('shot' + (++shotIdx))) + '.png';
        await page.screenshot({ path: path.join(OUTDIR, name) });
        console.log('shot', name);
      } else if (s.type === 'eval') {
        const v = await page.evaluate((expr) => {
          try { return eval(expr); } catch (e) { return 'ERR: ' + e.message; }
        }, s.expr);
        console.log('eval', s.expr, '=>', JSON.stringify(v));
        logs.push('[eval] ' + s.expr + ' => ' + JSON.stringify(v));
      } else if (s.type === 'dumpStorage') {
        const keys = await page.evaluate(() => {
          const out = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            out[k] = String(localStorage.getItem(k)).slice(0, 400);
          }
          return out;
        });
        console.log('=== localStorage (' + Object.keys(keys).length + ') ===');
        for (const k of Object.keys(keys)) console.log('  ', k, '=', keys[k]);
        logs.push('[storage] ' + JSON.stringify(keys).slice(0, 2000));
      }
    }
  }

  fs.writeFileSync(path.join(OUTDIR, 'console.log'), logs.join('\n'), 'utf-8');
  console.log('日志写入', path.join(OUTDIR, 'console.log'));

  await context.close();
  if (browser) await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
