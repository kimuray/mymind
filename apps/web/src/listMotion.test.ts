import { describe, expect, it } from 'vitest';
import { parseDuration, planListMotion, type RowPosition } from './listMotion';

const at = (entries: [string, number][]) =>
  new Map<string, RowPosition>(entries.map(([key, y]) => [key, { x: 0, y }]));

describe('FR-U01 リストの行の動き（DESIGN.md 4.18）', () => {
  it('並べ替えで入れ替わった2行は、元の位置からのずれで動かす', () => {
    const plan = planListMotion(
      at([
        ['a', 0],
        ['b', 48],
      ]),
      at([
        ['b', 0],
        ['a', 48],
      ]),
    );
    expect(plan.moves).toEqual([
      { key: 'b', dx: 0, dy: 48 },
      { key: 'a', dx: 0, dy: -48 },
    ]);
    expect(plan.enters).toEqual([]);
    expect(plan.exits).toEqual([]);
  });

  it('位置が変わらない行は動かさない', () => {
    const plan = planListMotion(at([['a', 0]]), at([['a', 0.2]]));
    expect(plan.moves).toEqual([]);
  });

  it('新しく現れた行は、現れる動きにする', () => {
    const plan = planListMotion(
      at([['a', 0]]),
      at([
        ['a', 0],
        ['b', 48],
      ]),
    );
    expect(plan.enters).toEqual(['b']);
  });

  it('なくなった行は、消える動きにする', () => {
    const plan = planListMotion(
      at([
        ['a', 0],
        ['b', 48],
      ]),
      at([['a', 0]]),
    );
    expect(plan.exits).toEqual(['b']);
  });

  it('欄をまたいで移った行も、同じ key なら位置の移動にする', () => {
    // 完了にした行が、下の「完了」の欄へ移る
    const plan = planListMotion(
      at([
        ['a', 0],
        ['b', 48],
      ]),
      at([
        ['b', 0],
        ['a', 160],
      ]),
    );
    expect(plan.moves).toContainEqual({ key: 'a', dx: 0, dy: -160 });
    expect(plan.exits).toEqual([]);
  });

  it('CSS 変数の時間をミリ秒にする', () => {
    expect(parseDuration('200ms')).toBe(200);
    expect(parseDuration(' 0.32s')).toBe(320);
    expect(parseDuration('')).toBe(0);
  });
});
