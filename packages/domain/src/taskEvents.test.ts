import { describe, expect, it } from 'vitest';
import { changeStatus } from './taskEvents';

const base = { taskId: 't1', at: '2026-09-23T01:00:00.000Z', day: '2026-09-23' };

describe('FR-T04 ステータス変更のイベント', () => {
  it('遷移できる変更は、変更前後のステータスと時刻を持つイベントになる', () => {
    expect(changeStatus({ ...base, from: 'todo', to: 'doing' })).toEqual({
      ok: true,
      value: { type: 'status_changed', ...base, from: 'todo', to: 'doing' },
    });
  });

  it.each([['todo'], ['doing']] as const)(
    '完了から %s に戻すと、完了の取り消しのイベントになる',
    (to) => {
      expect(changeStatus({ ...base, from: 'done', to })).toMatchObject({
        ok: true,
        value: { type: 'completion_undone', from: 'done', to },
      });
    },
  );

  it('中止から未着手に戻すのは、完了の取り消しではない', () => {
    expect(changeStatus({ ...base, from: 'cancelled', to: 'todo' })).toMatchObject({
      ok: true,
      value: { type: 'status_changed' },
    });
  });
});

describe('FR-T03 遷移できない変更', () => {
  it.each([
    ['todo', 'done'],
    ['cancelled', 'doing'],
    ['done', 'cancelled'],
    ['doing', 'doing'],
  ] as const)('%s から %s への変更は失敗を返す', (from, to) => {
    expect(changeStatus({ ...base, from, to })).toEqual({
      ok: false,
      error: { kind: 'invalid_transition', from, to },
    });
  });
});
