import { describe, expect, it } from 'vitest';
import { shouldAnimateSwap } from './detailMotion';

describe('FR-U04 詳細ペインの中身の入れ替え（DESIGN.md 3章）', () => {
  it('間を空けて別の項目を選んだら、入れ替えに動きを付ける', () => {
    expect(shouldAnimateSwap(1000, 500, false)).toBe(true);
  });

  it('J・K で続けて選んでいるあいだは、ちらつかないよう動きを付けない', () => {
    expect(shouldAnimateSwap(1000, 900, false)).toBe(false);
  });

  it('視差効果を減らす設定では、動きを付けない', () => {
    expect(shouldAnimateSwap(1000, 0, true)).toBe(false);
  });
});
