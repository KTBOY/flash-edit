import { describe, expect, it } from 'vitest';
import { downloadTaskId, sanitizeFileName } from '@shared/download';

describe('sanitizeFileName', () => {
  it('替换非法字符为下划线', () => {
    expect(sanitizeFileName('闪客快打4:修改版?')).toBe('闪客快打4_修改版_');
  });

  it('限长 80 字符', () => {
    expect(sanitizeFileName('a'.repeat(120)).length).toBe(80);
  });
});

describe('downloadTaskId', () => {
  it('带上来源前缀，避免两个站点的同号游戏互相覆盖', () => {
    expect(downloadTaskId('gamebox', '1')).toBe('gamebox:1');
    expect(downloadTaskId('oldswf', '1')).toBe('oldswf:1');
  });
});
