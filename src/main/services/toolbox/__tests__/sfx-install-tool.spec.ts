import { describe, expect, it } from 'vitest';
import {
  SFX_INSTALL_DIALOG,
  SFX_INSTALL_POWERSHELL_SNIPPET,
  buildSfxInstallBat,
  computeLauncherRelPath,
  computeTargetDir,
  isWinRarSfx
} from '../sfx-install-tool.service';

/** 从 bat 文本里抽出某个环境变量并按 UTF-16LE 解码 */
function decodeEnv(bat: string, name: string): string {
  const m = bat.match(new RegExp(`set "${name}=([^"]+)"`));
  if (!m) throw new Error(`bat 中未找到 ${name}`);
  return Buffer.from(m[1], 'base64').toString('utf16le');
}

/** RAR 归档签名：Rar! + 1A 07（RAR4 补 00，RAR5 补 01 00） */
function rarMarker(version: 4 | 5): Buffer {
  return Buffer.concat([
    Buffer.from('MZ', 'latin1'),
    Buffer.alloc(600), // SFX 模块占位
    Buffer.from('Rar!', 'latin1'),
    version === 4 ? Buffer.from([0x1a, 0x07, 0x00]) : Buffer.from([0x1a, 0x07, 0x01, 0x00])
  ]);
}

describe('computeTargetDir', () => {
  it('SFX 同目录同名文件夹（去扩展名）', () => {
    expect(computeTargetDir('E:\\TBGAME2\\tl\\Dragon Cht.exe')).toBe(
      'E:\\TBGAME2\\tl\\Dragon Cht'
    );
  });

  it('容忍大写扩展名', () => {
    expect(computeTargetDir('E:\\games\\仙剑.EXE')).toBe('E:\\games\\仙剑');
  });
});

describe('computeLauncherRelPath', () => {
  const target = 'E:\\TBGAME2\\tl\\Dragon Cht';

  it('启动器在目标根目录 → 相对路径', () => {
    expect(computeLauncherRelPath(target, 'E:\\TBGAME2\\tl\\Dragon Cht\\Dragon.exe')).toBe(
      'Dragon.exe'
    );
  });

  it('启动器在目标子目录 → 带目录的相对路径', () => {
    expect(computeLauncherRelPath(target, 'E:\\TBGAME2\\tl\\Dragon Cht\\bin\\game.exe')).toBe(
      'bin\\game.exe'
    );
  });

  it('启动器在目标外 → 抛错', () => {
    expect(() => computeLauncherRelPath(target, 'E:\\other\\Dragon.exe')).toThrow();
    expect(() => computeLauncherRelPath(target, 'E:\\TBGAME2\\tl\\Dragon Cht2\\Dragon.exe')).toThrow();
  });
});

describe('isWinRarSfx', () => {
  it('识别 RAR4 / RAR5 签名', () => {
    expect(isWinRarSfx(rarMarker(4))).toBe(true);
    expect(isWinRarSfx(rarMarker(5))).toBe(true);
  });

  it('无签名 / 不完整签名返回 false', () => {
    expect(isWinRarSfx(Buffer.from('MZ plain executable'))).toBe(false);
    expect(isWinRarSfx(Buffer.concat([Buffer.from('Rar!'), Buffer.from([0x00])]))).toBe(false);
  });
});

describe('buildSfxInstallBat', () => {
  const input = {
    sfxName: 'Dragon Cht.exe',
    launcherRelPath: 'Dragon.exe'
  };

  it('portable 模式：%~dp0 相对目录，无绝对路径段', () => {
    const bat = buildSfxInstallBat({ ...input, mode: 'portable' });
    expect(bat).toContain('set "SD_DIR=%~dp0"');
    expect(bat).not.toContain('set "SD_DIR_B64=');
    expect(decodeEnv(bat, 'SD_SFX_B64')).toBe('Dragon Cht.exe');
    expect(decodeEnv(bat, 'SD_REL_B64')).toBe('Dragon.exe');
  });

  it('absolute 模式：SFX 目录经 base64 内嵌且可解码', () => {
    const bat = buildSfxInstallBat({
      ...input,
      mode: 'absolute',
      sfxDir: 'E:\\TBGAME2\\tl'
    });
    expect(decodeEnv(bat, 'SD_DIR_B64')).toBe('E:\\TBGAME2\\tl');
    expect(bat).not.toContain('%~dp0');
  });

  it('正文纯 ASCII（中文只经 base64），行尾 CRLF，含 -s2 与 -d 开关', () => {
    const bat = buildSfxInstallBat({ ...input, mode: 'portable' });
    // 去掉 \r\n 后整个正文必须落在 ASCII 区间
    for (const ch of bat.replace(/\r\n/g, '')) {
      expect(ch.charCodeAt(0)).toBeLessThan(128);
    }
    expect(bat.includes('\r\n')).toBe(true);
    expect(SFX_INSTALL_POWERSHELL_SNIPPET).toContain('-s2');
    expect(SFX_INSTALL_POWERSHELL_SNIPPET).toContain('-d');
  });

  it('弹窗文案经 base64 解码为中文', () => {
    const decoded = Buffer.from(
      SFX_INSTALL_POWERSHELL_SNIPPET.match(
        /FromBase64String\('([A-Za-z0-9+/=]+)'\)/
      )?.[1] ?? '',
      'base64'
    ).toString('utf16le');
    expect(decoded).toBe(SFX_INSTALL_DIALOG.title);
  });

  it('PowerShell 主体不出现双引号（不破坏 cmd 外层引号）', () => {
    expect(SFX_INSTALL_POWERSHELL_SNIPPET.includes('"')).toBe(false);
  });

  it('启动器动态查找：不写死层级，解压后在目标及两层子目录里搜索', () => {
    expect(SFX_INSTALL_POWERSHELL_SNIPPET).toContain('function FindLauncher');
    // 别名优先级高于函数：函数名绝不能用 FL 这种短名（fl = Format-List 别名）
    expect(SFX_INSTALL_POWERSHELL_SNIPPET).not.toMatch(/function FL\{/);
    // 三种基准：$target 本身 + 一层 + 两层子目录
    expect(SFX_INSTALL_POWERSHELL_SNIPPET.match(/Join-Path \$_ \$rel/g)).toHaveLength(1);
    expect(SFX_INSTALL_POWERSHELL_SNIPPET).toContain('@($target)+');
    expect(SFX_INSTALL_POWERSHELL_SNIPPET).toContain(
      "Get-ChildItem -LiteralPath $target -Directory -ErrorAction SilentlyContinue"
    );
    // 解压前查一次，解压后再查一次（两次赋值）
    expect(SFX_INSTALL_POWERSHELL_SNIPPET.match(/\$launcher=FindLauncher;/g)).toHaveLength(2);
  });
});
