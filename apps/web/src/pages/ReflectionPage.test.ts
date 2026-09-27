import { describe, expect, it } from 'vitest';
import { toggleModes } from './ReflectionPage';

describe('FR-D06 ⌘P で書く／プレビューを切り替える', () => {
  const write = { thoughtsMd: 'write', learningMd: 'write' } as const;

  it('フォーカスのある欄だけを切り替える', () => {
    expect(toggleModes(write, 'learningMd')).toEqual({
      thoughtsMd: 'write',
      learningMd: 'preview',
    });
  });

  it('欄の外で押すと、どちらかが「書く」なら両方をプレビューにする', () => {
    expect(toggleModes({ thoughtsMd: 'preview', learningMd: 'write' }, null)).toEqual({
      thoughtsMd: 'preview',
      learningMd: 'preview',
    });
  });

  it('欄の外で押すと、両方がプレビューなら両方を「書く」に戻す', () => {
    expect(toggleModes({ thoughtsMd: 'preview', learningMd: 'preview' }, null)).toEqual(write);
  });
});
