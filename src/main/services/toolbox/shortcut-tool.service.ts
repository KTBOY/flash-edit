import { open, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { ShortcutBatMode, ShortcutBatResult } from '@shared/types'
import { isWindowsExecutable } from '../exe-pack.service'
import { logger } from '../../infra/logger'

/**
 * 工具箱 · 创建快捷方式。
 *
 * 生成一个自包含的 bat：双击即在桌面创建指向目标 EXE 的快捷方式，
 * 供随文件夹分发使用。核心约束是 bat 正文必须保持纯 ASCII——
 * cmd 按系统代码页（GBK）解码批处理内容，UTF-8 中文写进去必乱码。
 * 因此中文只出现在两个安全的位置：
 *   1. bat 的文件名（NTFS 文件名不经过代码页）；
 *   2. exe 文件名 / 绝对目录，经 base64(UTF-16LE) 内嵌，由 PowerShell 解码——
 *      目录本身在 portable 模式用 %~dp0 运行时展开，同样不落进文件字节。
 * 这样 exe 名叫什么（中文 / 空格 / &()[]）都不需要转义。
 */

/** 生成的 bat 固定文件名 */
export const SHORTCUT_BAT_NAME = '点我就可以创建快捷方式.bat'

export interface ShortcutBatOptions {
  exePath: string
  outputDir: string
}

/** UTF-16LE → base64，与 PowerShell 的 [Text.Encoding]::Unicode 对应 */
export function utf16leBase64(text: string): string {
  return Buffer.from(text, 'utf16le').toString('base64')
}

/**
 * bat 运行时的弹窗文案。中文不能直接写进 bat（cmd 按系统代码页解码会乱码），
 * 全部经 base64(UTF-16LE) 内嵌、由 PowerShell 解码后交给 WinForms MessageBox 展示。
 */
export const SHORTCUT_DIALOG = {
  /** 成功弹窗标题 */
  title: '闪电Flash',
  /** 成功弹窗正文：创建成功提示 + 是否顺手打开游戏的询问（\n 为真实换行符） */
  body: '桌面快捷方式创建成功！\n\n要顺便打开游戏吗？（是 = 打开游戏，否 = 关闭）',
  /** 找不到目标 EXE 时的控制台错误前缀 */
  errorPrefix: '未找到游戏文件：'
} as const

/**
 * PowerShell 主体。目录二选一：环境变量 SD_DIR（portable，由 %~dp0 展开）
 * 或 SD_DIR_B64（absolute，base64 解码）；文件名与文案恒走 base64 解码。
 * 全程 LiteralPath（游戏名可能含 [] 等通配符字符）。
 * 流程：创建快捷方式 → MessageBox 弹窗提示成功并询问 → 是则 Start-Process 打开游戏；
 * 失败 exit 1，由外层 `if errorlevel 1 pause` 留住控制台显示错误。
 */
const POWERSHELL_SNIPPET = [
  '$E=[Text.Encoding]::Unicode;',
  "if($env:SD_DIR_B64){$d=$E.GetString([Convert]::FromBase64String($env:SD_DIR_B64))}else{$d=$env:SD_DIR};",
  '$n=$E.GetString([Convert]::FromBase64String($env:SD_NAME_B64));',
  '$t=Join-Path $d $n;',
  `if(-not(Test-Path -LiteralPath $t)){Write-Host ($E.GetString([Convert]::FromBase64String('${utf16leBase64(SHORTCUT_DIALOG.errorPrefix)}'))+$t);exit 1};`,
  '$w=New-Object -ComObject WScript.Shell;',
  "$k=[Environment]::GetFolderPath('Desktop');",
  "$s=$w.CreateShortcut((Join-Path $k ($n+'.lnk')));",
  '$s.TargetPath=$t;$s.WorkingDirectory=$d;$s.Save();',
  'Add-Type -AssemblyName System.Windows.Forms;',
  `$r=[System.Windows.Forms.MessageBox]::Show($E.GetString([Convert]::FromBase64String('${utf16leBase64(SHORTCUT_DIALOG.body)}')),$E.GetString([Convert]::FromBase64String('${utf16leBase64(SHORTCUT_DIALOG.title)}')),'YesNo','Information');`,
  "if($r -eq 'Yes'){Start-Process -FilePath $t -WorkingDirectory $d}"
].join('')

export interface ShortcutBatTemplateInput {
  mode: ShortcutBatMode
  /** 目标 EXE 的文件名（不含目录） */
  exeName: string
  /** absolute 模式的 EXE 所在目录 */
  exeDir?: string
}

/** 生成 bat 文本（纯函数，便于测试）。行尾 CRLF，正文可断言为纯 ASCII */
export function buildShortcutBat(input: ShortcutBatTemplateInput): string {
  const lines: string[] = ['@echo off']
  if (input.mode === 'portable') {
    // %~dp0 双击运行时才展开成真实目录，文件夹挪位置后 bat 依然有效
    lines.push('set "SD_DIR=%~dp0"')
  } else {
    if (!input.exeDir) throw new Error('absolute 模式必须提供 exeDir')
    lines.push(`set "SD_DIR_B64=${utf16leBase64(input.exeDir)}"`)
  }
  lines.push(`set "SD_NAME_B64=${utf16leBase64(input.exeName)}"`)
  lines.push(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${POWERSHELL_SNIPPET}"`)
  // 成功路径的交互全部在弹窗里，控制台直接收尾；失败才暂停让用户看清错误
  lines.push('if errorlevel 1 pause')
  return lines.join('\r\n') + '\r\n'
}

/**
 * 判定生成模式：bat 输出目录与 EXE 同目录 → portable（%~dp0），
 * 否则 absolute（内嵌绝对路径）。resolve 归一化后按 Windows 习惯忽略大小写。
 */
export function resolveShortcutMode(exePath: string, outputDir: string): ShortcutBatMode {
  const exeDir = dirname(resolve(exePath))
  const out = resolve(outputDir)
  return exeDir.toLowerCase() === out.toLowerCase() ? 'portable' : 'absolute'
}

/** 校验目标确实是 Windows EXE（MZ 头）；只读头部两个字节，不整份载入 */
async function assertWindowsExe(exePath: string): Promise<void> {
  let handle
  try {
    handle = await open(exePath, 'r')
  } catch {
    throw new Error(`启动程序不存在或无法读取：${exePath}`)
  }
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(64), 0, 64, 0)
    if (!isWindowsExecutable(buffer.subarray(0, bytesRead))) {
      throw new Error('所选文件不是 Windows 可执行文件（缺少 MZ 头）')
    }
  } finally {
    await handle.close()
  }
}

/** 生成并落盘 bat；目标校验失败或写盘失败时抛出带说明的错误 */
export async function createShortcutBat(options: ShortcutBatOptions): Promise<ShortcutBatResult> {
  const { exePath, outputDir } = options
  const exeName = basename(exePath)
  const mode = resolveShortcutMode(exePath, outputDir)
  await assertWindowsExe(exePath)

  const content = buildShortcutBat({
    mode,
    exeName,
    exeDir: mode === 'absolute' ? dirname(resolve(exePath)) : undefined
  })
  const batPath = join(outputDir, SHORTCUT_BAT_NAME)
  try {
    await mkdir(outputDir, { recursive: true })
    await writeFile(batPath, content, 'utf8')
  } catch (error) {
    throw new Error(`写入 bat 失败（目录可能不可写）：${error instanceof Error ? error.message : String(error)}`)
  }
  logger.info('toolbox', `已生成快捷方式 bat：${batPath}（${mode} → ${exePath}）`)
  return { batPath, targetPath: exePath, mode }
}
