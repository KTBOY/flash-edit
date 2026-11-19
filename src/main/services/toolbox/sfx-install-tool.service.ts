import { mkdir, open, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { SfxInstallBatResult, ShortcutBatMode } from '@shared/types'
import { isWindowsExecutable } from '../exe-pack.service'
import { isInsideDir } from '../../infra/paths'
import { logger } from '../../infra/logger'
import { resolveShortcutMode, utf16leBase64 } from './shortcut-tool.service'

/**
 * 工具箱 · 一键解压安装。
 *
 * 面向「游戏以 WinRAR 自解压包（SFX）形式分发」的场景：生成一个自包含 bat，
 * 双击即静默解压到 SFX 同目录同名文件夹，再弹窗询问是否创建桌面快捷方式、
 * 是否立刻打开游戏——收件人零操作成本。
 *
 * 沿用 shortcut-tool 的纯 ASCII 方案：中文只出现在 bat 文件名与
 * base64(UTF-16LE) 内嵌文案里，cmd 按代码页解码不会乱码；
 * 所有用户路径只进 base64 环境变量，避开 set 行的 % 转义问题。
 *
 * 解压命令依赖 WinRAR GUI SFX 模块的运行时开关（官方文档 HELPGUISFXCmd）：
 *   -s2 隐藏开始对话框但保留解压进度（大包解压可见进度，优于全静默 -s）
 *   -d<路径> 指定解压目标，参数内嵌引号处理含空格路径
 * 生成前扫描 exe 头部确认确为 WinRAR SFX（Rar! 签名），其它格式直接报错。
 */

/** 生成的 bat 固定文件名 */
export const SFX_INSTALL_BAT_NAME = '一键解压安装.bat'

/** WinRAR SFX 签名扫描范围：GUI SFX 模块本体可达 1MB+，压缩数据跟随其后 */
const SFX_SCAN_BYTES = 4 * 1024 * 1024

export interface SfxInstallBatOptions {
  sfxPath: string
  launcherPath: string
  outputDir: string
}

export interface SfxInstallBatTemplateInput {
  mode: ShortcutBatMode
  /** absolute 模式的 SFX 所在目录 */
  sfxDir?: string
  /** SFX 文件名（含扩展名） */
  sfxName: string
  /** 启动器在解压目标内的相对路径 */
  launcherRelPath: string
}

/** bat 运行时弹窗文案，中文经 base64(UTF-16LE) 内嵌后由 PowerShell 解码 */
export const SFX_INSTALL_DIALOG = {
  title: '闪电Flash',
  /** 解压后未找到启动器的报错前缀（拼接解压目标目录展示） */
  errorPrefix: '解压后未找到启动器（已搜索解压目标及其两层子目录）：',
  /** 已就绪询问是否创建桌面快捷方式（无论本次是否解压都成立） */
  promptShortcut: '游戏已就绪！要在桌面创建游戏快捷方式吗？\n\n（是 = 创建，否 = 跳过）',
  /** 询问是否立刻打开游戏 */
  promptOpen: '要立刻打开游戏吗？\n\n（是 = 打开游戏，否 = 关闭）'
} as const

/**
 * 在解压目标及其两层子目录里搜索「相对路径 = $rel」的启动器（FindLauncher 函数）。
 * 包结构不可预知：有的包文件直接在根上，有的自带一层（甚至两层）根文件夹——
 * 每次都以 $target / $target\* / $target\*\* 为基准拼 $rel 动态定位，
 * 不写死任何层级。找不到返回 $null。
 * 注意函数名不能取 FL 之类的短名：fl 是 Format-List 的内置别名，
 * 且别名解析优先级高于函数，取短名会让查找静默失效。
 */
const SFX_FIND_LAUNCHER_SNIPPET = [
  'function FindLauncher{',
  '@($target)+',
  '@(Get-ChildItem -LiteralPath $target -Directory -ErrorAction SilentlyContinue|ForEach-Object{$_.FullName})+',
  '@(Get-ChildItem -LiteralPath $target -Directory -ErrorAction SilentlyContinue|ForEach-Object{Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue}|ForEach-Object{$_.FullName})|',
  'ForEach-Object{Join-Path $_ $rel}|',
  'Where-Object{Test-Path -LiteralPath $_}|',
  'Select-Object -First 1',
  '}'
].join('')

/**
 * PowerShell 主体（常量，所有动态值经 base64 环境变量传入，便于测试断言）。
 * 流程：解出 SFX 路径 → 动态查找启动器（已解压过则跳过解压）→ 否则 -s2 -d"目标"
 * 静默解压并等待 → 再查找 → 校验 → 询问建快捷方式 → 询问打开游戏。
 * [char]34 内嵌双引号构造 -d 参数，避免在 cmd 外层引号里出现双引号。
 */
export const SFX_INSTALL_POWERSHELL_SNIPPET = [
  '$E=[Text.Encoding]::Unicode;',
  "if($env:SD_DIR_B64){$d=$E.GetString([Convert]::FromBase64String($env:SD_DIR_B64))}else{$d=$env:SD_DIR};",
  "$sfx=Join-Path $d ($E.GetString([Convert]::FromBase64String($env:SD_SFX_B64)));",
  '$target=Join-Path (Split-Path $sfx) ([IO.Path]::GetFileNameWithoutExtension($sfx));',
  '$rel=$E.GetString([Convert]::FromBase64String($env:SD_REL_B64));',
  'Add-Type -AssemblyName System.Windows.Forms;',
  `$t=$E.GetString([Convert]::FromBase64String('${utf16leBase64(SFX_INSTALL_DIALOG.title)}'));`,
  SFX_FIND_LAUNCHER_SNIPPET + ';',
  '$launcher=FindLauncher;',
  'if(-not $launcher){',
  "Start-Process -FilePath $sfx -ArgumentList @('-s2',('-d'+[char]34+$target+[char]34)) -Wait;",
  '$launcher=FindLauncher;}',
  'if(-not $launcher){',
  `$r=[System.Windows.Forms.MessageBox]::Show(($E.GetString([Convert]::FromBase64String('${utf16leBase64(SFX_INSTALL_DIALOG.errorPrefix)}'))+$target),$t,'OK','Error')|Out-Null;`,
  'exit 1};',
  `$ok=$E.GetString([Convert]::FromBase64String('${utf16leBase64(SFX_INSTALL_DIALOG.promptShortcut)}'));`,
  "$r1=[System.Windows.Forms.MessageBox]::Show($ok,$t,'YesNo','Question');",
  "if($r1 -eq 'Yes'){",
  '$w=New-Object -ComObject WScript.Shell;',
  "$k=[Environment]::GetFolderPath('Desktop');",
  '$n=[IO.Path]::GetFileNameWithoutExtension($launcher);',
  "$s=$w.CreateShortcut((Join-Path $k ($n+'.lnk')));",
  '$s.TargetPath=$launcher;$s.WorkingDirectory=(Split-Path $launcher);$s.Save();',
  '};',
  `$go=$E.GetString([Convert]::FromBase64String('${utf16leBase64(SFX_INSTALL_DIALOG.promptOpen)}'));`,
  "$r2=[System.Windows.Forms.MessageBox]::Show($go,$t,'YesNo','Question');",
  'if($r2 -eq \'Yes\'){Start-Process -FilePath $launcher -WorkingDirectory (Split-Path $launcher)}'
].join('')

/** 解压目标目录：SFX 同目录同名文件夹（Dragon Cht.exe → 同目录 Dragon Cht\） */
export function computeTargetDir(sfxPath: string): string {
  const resolved = resolve(sfxPath)
  const name = basename(resolved).replace(/\.exe$/i, '')
  return join(dirname(resolved), name)
}

/**
 * 启动器在解压目标内的相对路径；不在目标内时抛错——
 * 快捷方式与打开游戏都依赖「解压目标 + 相对路径」定位，越界即失准。
 */
export function computeLauncherRelPath(targetDir: string, launcherPath: string): string {
  const rel = relative(resolve(targetDir), resolve(launcherPath))
  if (!rel || rel.startsWith('..')) {
    throw new Error('启动游戏 EXE 必须位于解压目标目录（SFX 同目录同名文件夹）内。请到解压后的同名文件夹里选择启动器')
  }
  return rel
}

/** 判定缓冲区（exe 头部）是否为 WinRAR 自解压包：搜索 Rar! 签名（0x52 0x61 0x72 0x21 0x1A 0x07） */
export function isWinRarSfx(head: Buffer): boolean {
  let from = 0
  for (;;) {
    const idx = head.indexOf('Rar!', from, 'latin1')
    if (idx < 0 || idx + 6 > head.length) return false
    // RAR4: 1A 07 00，RAR5: 1A 07 01 00——第 5 字节必须是归档标记 0x1A
    if (head[idx + 4] === 0x1a && head[idx + 5] === 0x07) return true
    from = idx + 1
  }
}

/** 读取文件头部若干字节（SFX 签名扫描 / EXE 头校验共用） */
async function readHead(path: string, bytes: number): Promise<Buffer | null> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** 生成 bat 文本（纯函数，便于测试）。行尾 CRLF，正文可断言为纯 ASCII */
export function buildSfxInstallBat(input: SfxInstallBatTemplateInput): string {
  const lines = ['@echo off']
  if (input.mode === 'portable') {
    // %~dp0 双击运行时才展开成 SFX 真实目录，游戏包整个挪位置后 bat 依然有效
    lines.push('set "SD_DIR=%~dp0"')
  } else {
    if (!input.sfxDir) throw new Error('absolute 模式必须提供 sfxDir')
    lines.push(`set "SD_DIR_B64=${utf16leBase64(input.sfxDir)}"`)
  }
  lines.push(`set "SD_SFX_B64=${utf16leBase64(input.sfxName)}"`)
  lines.push(`set "SD_REL_B64=${utf16leBase64(input.launcherRelPath)}"`)
  lines.push(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${SFX_INSTALL_POWERSHELL_SNIPPET}"`)
  // 失败路径的报错在弹窗里，控制台 pause 留住窗口便于看清是否异常退出
  lines.push('if errorlevel 1 pause')
  return lines.join('\r\n') + '\r\n'
}

/** 校验并生成 bat；任何一步不满足都抛出带说明的错误 */
export async function createSfxInstallBat(options: SfxInstallBatOptions): Promise<SfxInstallBatResult> {
  const { sfxPath, launcherPath, outputDir } = options
  const resolvedSfx = resolve(sfxPath)

  const sfxHead = await readHead(resolvedSfx, SFX_SCAN_BYTES)
  if (!sfxHead || !isWindowsExecutable(sfxHead.subarray(0, 64))) {
    throw new Error(`游戏包不存在或无法读取：${resolvedSfx}`)
  }
  if (!isWinRarSfx(sfxHead)) {
    throw new Error('所选 EXE 不是 WinRAR 自解压包（未找到 Rar! 签名），无法生成一键解压安装 bat')
  }

  const launcherHead = await readHead(launcherPath, 64)
  if (!launcherHead || !isWindowsExecutable(launcherHead)) {
    throw new Error(`启动游戏 EXE 不存在或不是有效的 Windows 可执行文件：${launcherPath}`)
  }

  const targetDir = computeTargetDir(resolvedSfx)
  if (!isInsideDir(launcherPath, targetDir)) {
    throw new Error(
      `启动游戏 EXE 必须位于解压目标目录内：${targetDir}。请先解压一次，再到解压后的同名文件夹里选择启动器`
    )
  }
  const launcherRelPath = computeLauncherRelPath(targetDir, launcherPath)
  const mode = resolveShortcutMode(resolvedSfx, outputDir)

  const content = buildSfxInstallBat({
    mode,
    sfxDir: mode === 'absolute' ? dirname(resolvedSfx) : undefined,
    sfxName: basename(resolvedSfx),
    launcherRelPath
  })
  const batPath = join(outputDir, SFX_INSTALL_BAT_NAME)
  try {
    await mkdir(outputDir, { recursive: true })
    await writeFile(batPath, content, 'utf8')
  } catch (error) {
    throw new Error(`写入 bat 失败（目录可能不可写）：${error instanceof Error ? error.message : String(error)}`)
  }
  logger.info(
    'toolbox',
    `已生成一键解压安装 bat：${batPath}（${mode} → ${resolvedSfx}，解压目标 ${targetDir}，启动器 ${launcherRelPath}）`
  )
  return { batPath, targetDir, launcherRelPath, mode }
}
