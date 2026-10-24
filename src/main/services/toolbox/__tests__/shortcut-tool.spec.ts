import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SHORTCUT_DIALOG,
  buildShortcutBat,
  createShortcutBat,
  resolveShortcutMode
} from '../shortcut-tool.service'

/** 中文 exe 名的 base64(UTF-16LE)，用于断言内嵌正确 */
function utf16leBase64(text: string): string {
  return Buffer.from(text, 'utf16le').toString('base64')
}

describe('快捷方式 bat 生成', () => {
  it('portable 模式：正文纯 ASCII、CRLF、含 %~dp0 与关键 PowerShell 调用', () => {
    const content = buildShortcutBat({ mode: 'portable', exeName: '美少女成长计划.exe' })

    // bat 按 GBK/ANSI 代码页解码，任何非 ASCII 字节都会乱码，必须全 ASCII
    expect(content).toMatch(/^[\x20-\x7E\r\n]*$/)
    expect(content).toContain('\r\n')
    expect(content).toContain('set "SD_DIR=%~dp0"')
    expect(content).toContain(`set "SD_NAME_B64=${utf16leBase64('美少女成长计划.exe')}"`)
    expect(content).toContain("GetFolderPath('Desktop')")
    expect(content).toContain('$s.WorkingDirectory=$d;')
    expect(content).not.toContain('美少女') // 中文名只能以 base64 出现
    expect(content.endsWith('if errorlevel 1 pause\r\n')).toBe(true)
  })

  it('成功提示与"是否打开游戏"询问经 WinForms 弹窗呈现，文案 base64 内嵌', () => {
    const content = buildShortcutBat({ mode: 'portable', exeName: 'game.exe' })

    expect(content).toContain('System.Windows.Forms.MessageBox')
    expect(content).toContain("'YesNo','Information'")
    expect(content).toContain("if($r -eq 'Yes'){Start-Process -FilePath $t -WorkingDirectory $d}")
    // 弹窗标题与正文（含询问打开游戏）均以 base64 出现
    expect(content).toContain(utf16leBase64(SHORTCUT_DIALOG.title))
    expect(content).toContain(utf16leBase64(SHORTCUT_DIALOG.body))
    expect(content).toContain(utf16leBase64(SHORTCUT_DIALOG.errorPrefix))
    // 中文文案本体不得落入 bat 字节
    expect(content).not.toContain('快捷方式')
    expect(content).not.toContain('游戏')
  })

  it('absolute 模式：目录以 base64 内嵌，不再使用 %~dp0', () => {
    const content = buildShortcutBat({
      mode: 'absolute',
      exeName: 'game.exe',
      exeDir: 'E:\\games\\目录A'
    })

    expect(content).toMatch(/^[\x20-\x7E\r\n]*$/)
    expect(content).toContain(`set "SD_DIR_B64=${utf16leBase64('E:\\games\\目录A')}"`)
    expect(content).not.toContain('%~dp0')
  })

  it('absolute 模式缺少 exeDir 时报错', () => {
    expect(() => buildShortcutBat({ mode: 'absolute', exeName: 'game.exe' })).toThrow()
  })

  it('目录判定：与 EXE 同目录（忽略大小写/末尾分隔符）→ portable，否则 absolute', () => {
    expect(resolveShortcutMode('E:\\games\\a\\game.exe', 'E:\\GAMES\\A')).toBe('portable')
    expect(resolveShortcutMode('E:\\games\\a\\game.exe', 'E:\\games\\a\\')).toBe('portable')
    expect(resolveShortcutMode('E:\\games\\a\\game.exe', 'E:\\games\\b')).toBe('absolute')
  })

  describe('落盘（临时目录）', () => {
    let dir: string

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
    })

    it('写出生效的 bat，且 portable 模式正确识别', async () => {
      dir = await mkdtemp(join(tmpdir(), 'shortcut-spec-'))
      const exePath = join(dir, '游戏.exe')
      await writeFile(exePath, Buffer.from([0x4d, 0x5a, 0x90, 0x00]))

      const result = await createShortcutBat({ exePath, outputDir: dir })
      expect(result.mode).toBe('portable')
      expect(result.targetPath).toBe(exePath)
      expect(result.batPath).toBe(join(dir, '点我就可以创建快捷方式.bat'))

      const content = await readFile(result.batPath, 'utf8')
      expect(content).toMatch(/^[\x20-\x7E\r\n]*$/)
      expect(content).toContain('set "SD_DIR=%~dp0"')
    })

    it('非 EXE 文件拒绝生成', async () => {
      dir = await mkdtemp(join(tmpdir(), 'shortcut-spec-'))
      const notExe = join(dir, 'fake.exe')
      await writeFile(notExe, Buffer.from('plain text'))

      await expect(createShortcutBat({ exePath: notExe, outputDir: dir })).rejects.toThrow(
        /MZ/
      )
    })

    it('目标不存在时给出可读错误', async () => {
      dir = await mkdtemp(join(tmpdir(), 'shortcut-spec-'))
      await expect(
        createShortcutBat({ exePath: join(dir, 'missing.exe'), outputDir: dir })
      ).rejects.toThrow(/不存在/)
    })
  })
})
