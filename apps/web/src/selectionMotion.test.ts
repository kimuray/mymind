import { describe, expect, it } from 'vitest';
import { remainingShift, scrollBehaviorFor, selectionShift } from './selectionMotion';

describe('FR-U01 選択のカーソルの動き（DESIGN.md 5.2）', () => {
  it('選択の面は、前の行の位置から新しい行へ滑らせる', () => {
    expect(selectionShift({ x: 0, y: 0 }, { x: 0, y: 48 })).toEqual({ dx: 0, dy: -48 });
  });

  it('前の面が動きの途中なら、今見えている位置から動かし直す', () => {
    // 前の行（y=48）の面は、まだ 20px 上に見えている
    expect(selectionShift({ x: 0, y: 48 }, { x: 0, y: 96 }, { x: 0, y: -20 })).toEqual({
      dx: 0,
      dy: -68,
    });
  });

  it('間を空けて動かしたときは、なめらかにスクロールする', () => {
    expect(scrollBehaviorFor(1000, 500, false)).toBe('smooth');
  });

  it('キーを押しっぱなしにしたときは、すぐ追従する', () => {
    expect(scrollBehaviorFor(1000, 970, false)).toBe('instant');
  });

  it('視差効果を減らす設定では、すぐ追従する', () => {
    expect(scrollBehaviorFor(1000, 0, true)).toBe('instant');
  });

  it('動きの途中の面は、始めのずれのうち残りの分だけずれて見える', () => {
    expect(remainingShift({ dx: 0, dy: -48 }, 0.25)).toEqual({ x: 0, y: -36 });
  });

  it('動きの進み具合が分からないときは、ずれがないものとする', () => {
    expect(remainingShift({ dx: 0, dy: -48 }, null)).toEqual({ x: 0, y: 0 });
  });
});
