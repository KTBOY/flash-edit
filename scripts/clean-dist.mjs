// 打包前清理：解决 electron-builder 清空 dist/win-unpacked 时
// 因 app.asar 等文件被占用而整体失败的问题（ERR_ELECTRON_BUILDER_CANNOT_EXECUTE）。
//
// 三步：结束从 dist 启动的旧版进程 → 带重试删除输出目录 → 仍失败给出中文诊断。
// 只针对本项目 dist 目录，不会影响其他程序或系统进程。
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 与 package.json build.directories.output 保持一致
const outDir = resolve(root, 'dist/build')
// 旧版产物目录（历史遗留，里面可能有被长期占用的文件）：尽力清理，失败不阻断
const legacyDir = resolve(root, 'dist/win-unpacked')
const isWindows = process.platform === 'win32'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Step 1：结束「可执行文件位于本项目 dist 内」的进程（最常见占用源：上次打包后忘记关掉的旧版程序） */
async function killProcessesFromDist() {
  if (!isWindows) return

  const targets = [outDir, legacyDir]
  const existing = targets.filter((dir) => existsSync(dir))
  if (existing.length === 0) return

  const prefixes = existing
    .map((dir) => (dir.endsWith('\\') ? dir : `${dir}\\`))
    .map((dir) => dir.replace(/'/g, "''"))
  // -like 通配符路径里不包含 * ? [ ]，无需转义
  const ps =
    `Get-CimInstance Win32_Process | ` +
    `Where-Object { $_.ExecutablePath -and (${prefixes
      .map((prefix) => `$_.ExecutablePath -like '${prefix}*'`)
      .join(' -or ')}) } | ` +
    `Select-Object ProcessId, ExecutablePath | ConvertTo-Json -Compress`

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    timeout: 15000
  })

  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    if (result.error) {
      console.warn('[clean-dist] 无法枚举进程（PowerShell 不可用），跳过自动结束，继续尝试清理')
    }
    return
  }

  let rows
  try {
    const parsed = JSON.parse(result.stdout)
    rows = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return
  }

  let killed = 0
  for (const row of rows) {
    if (!row || !row.ProcessId) continue
    console.log(`[clean-dist] 结束旧版程序：PID ${row.ProcessId} ← ${row.ExecutablePath}`)
    spawnSync('taskkill', ['/F', '/PID', String(row.ProcessId)], { stdio: 'ignore' })
    killed += 1
  }
  if (killed > 0) {
    console.log(`[clean-dist] 已结束 ${killed} 个从 dist 启动的旧版程序，等待句柄释放…`)
    await sleep(1500)
  }
}

/** Step 3：列出仍被锁住的文件，给出可操作的处理建议 */
function reportLockedFiles(dir) {
  if (!existsSync(dir)) return
  const locked = []
  const walk = (current) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, name.name)
      if (name.isDirectory()) walk(full)
      else locked.push(full)
    }
  }
  try {
    walk(dir)
  } catch {
    locked.push(dir)
  }
  console.error('[clean-dist] 以下文件被占用，已重试 6 次仍无法删除：')
  for (const file of locked) console.error(`  - ${file}`)
}

function reportHints() {
  console.error('[clean-dist] 请按顺序排查：')
  console.error('  1. 任务管理器搜索「闪电Flash」或「Flash Game Trainer」，结束仍在运行的旧版程序')
  console.error('  2. 关闭资源管理器中打开 dist 目录的窗口（尤其左侧预览窗格会锁住 asar）')
  console.error('  3. 杀毒软件可能正在扫描刚生成的文件，等 1 分钟后重跑 npm run dist')
}

function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 })
}

async function main() {
  // 旧版产物目录：尽力清理，锁住也不阻断打包（electron-builder 不会再碰它）
  if (existsSync(legacyDir)) {
    try {
      removeDir(legacyDir)
      console.log('[clean-dist] 已清理历史遗留的 dist/win-unpacked')
    } catch {
      console.warn('[clean-dist] dist/win-unpacked 仍被占用，已跳过（不影响本次打包）')
    }
  }

  if (!existsSync(outDir)) {
    console.log('[clean-dist] 输出目录不存在，无需清理')
    return
  }

  await killProcessesFromDist()

  // fs.rm 的 maxRetries 原生覆盖 EBUSY / EPERM / ENOTEMPTY，正好对上杀软的瞬时锁
  try {
    removeDir(outDir)
    console.log('[clean-dist] 已清理 dist/build')
  } catch (error) {
    console.error(`[clean-dist] 清理失败：${error instanceof Error ? error.message : String(error)}`)
    reportLockedFiles(outDir)
    reportHints()
    process.exit(1)
  }
}

main()
