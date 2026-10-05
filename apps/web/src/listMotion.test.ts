import { describe, expect, it } from 'vitest';
import {
  type MotionItem,
  parseDuration,
  planListMotion,
  type RowPosition,
  survivingDescendants,
} from './listMotion';

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

  describe('FR-T06 入れ子（リストの面とその中の行）', () => {
    const item = (y: number, parent: string | null = null): MotionItem => ({ x: 0, y, parent });

    it('提案が出てリストの面が押し下げられたとき、中の行は面と一緒に動くので二重に動かさない', () => {
      const plan = planListMotion(
        new Map([
          ['list', item(100)],
          ['a', item(110, 'list')],
        ]),
        new Map([
          ['notice', item(100)],
          ['list', item(160)],
          ['a', item(170, 'list')],
        ]),
      );
      expect(plan.moves).toEqual([{ key: 'list', dx: 0, dy: -60 }]);
      expect(plan.enters).toEqual(['notice']);
    });

    it('面の中で並べ替えた行は、面のずれを差し引いて動かす', () => {
      const plan = planListMotion(
        new Map([
          ['list', item(100)],
          ['a', item(110, 'list')],
          ['b', item(160, 'list')],
        ]),
        new Map([
          ['notice', item(100)],
          ['list', item(160)],
          ['b', item(170, 'list')],
          ['a', item(220, 'list')],
        ]),
      );
      expect(plan.moves).toContainEqual({ key: 'b', dx: 0, dy: 50 });
      expect(plan.moves).toContainEqual({ key: 'a', dx: 0, dy: -50 });
    });

    it('面と一緒に現れた行は、面の動きに任せて個別には現れさせない', () => {
      const plan = planListMotion(
        new Map(),
        new Map([
          ['closed', item(300)],
          ['a', item(310, 'closed')],
        ]),
      );
      expect(plan.enters).toEqual(['closed']);
    });

    it('面と一緒に消えた行は、面の写しに含まれるので個別には消さない', () => {
      const plan = planListMotion(
        new Map([
          ['open', item(100)],
          ['a', item(110, 'open')],
        ]),
        new Map(),
      );
      expect(plan.exits).toEqual(['open']);
    });

    it('最後の完了タスクを未完了へ戻すと、「完了」の面の写しからその行を隠す', () => {
      const previous = new Map([
        ['open', item(100)],
        ['a', item(110, 'open')],
        ['closed', item(200)],
        ['b', item(210, 'closed')],
      ]);
      const next = new Map([
        ['open', item(100)],
        ['a', item(110, 'open')],
        ['b', item(160, 'open')],
      ]);
      expect(planListMotion(previous, next).exits).toEqual(['closed']);
      expect(survivingDescendants(previous, next, 'closed')).toEqual(['b']);
    });

    it('面と一緒に消える行は、写しの中で隠さない', () => {
      const previous = new Map([
        ['closed', item(200)],
        ['b', item(210, 'closed')],
      ]);
      expect(survivingDescendants(previous, new Map(), 'closed')).toEqual([]);
    });
  });
});
