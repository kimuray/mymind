import { describe, expect, it } from 'vitest';
import { rulesOnMoveToBacklog, rulesOnStatusChange, type TaskSnapshot } from './rules';
import type { Status } from './status';

const ctx = { at: '2026-09-23T01:00:00.000Z', day: '2026-09-23' };
const child = (status: Status, id = 'c1'): TaskSnapshot => ({ id, parentId: 'p1', status });
const parent = (status: Status): TaskSnapshot => ({ id: 'p1', parentId: null, status });

describe('FR-T06 着手中のタスクをバックログへ移すと中断にする', () => {
  it('着手中なら、中断のイベントと取り消しの提案を返す', () => {
    expect(rulesOnMoveToBacklog({ id: 't1', parentId: null, status: 'doing' }, ctx)).toEqual({
      events: [{ type: 'status_changed', taskId: 't1', ...ctx, from: 'doing', to: 'paused' }],
      suggestions: [{ kind: 'undo_auto_pause', taskId: 't1' }],
    });
  });

  it.each(['todo', 'paused', 'waiting', 'done', 'cancelled'] as const)(
    '%s なら何もしない',
    (status) => {
      expect(rulesOnMoveToBacklog({ id: 't1', parentId: null, status }, ctx)).toEqual({
        events: [],
        suggestions: [],
      });
    },
  );
});

describe('FR-T07 子の着手で未着手の親を着手中にする', () => {
  it('親が未着手なら、親を着手中にするイベントを返す', () => {
    const outcome = rulesOnStatusChange(
      { task: child('doing'), parent: parent('todo'), siblings: [] },
      ctx,
    );
    expect(outcome).toEqual({
      events: [{ type: 'status_changed', taskId: 'p1', ...ctx, from: 'todo', to: 'doing' }],
      suggestions: [],
    });
  });

  it.each(['doing', 'paused', 'waiting', 'done', 'cancelled'] as const)(
    '親が %s なら、親のステータスは変えない',
    (status) => {
      const outcome = rulesOnStatusChange(
        { task: child('doing'), parent: parent(status), siblings: [] },
        ctx,
      );
      expect(outcome.events).toEqual([]);
    },
  );

  it('親のないタスクでは何もしない', () => {
    expect(
      rulesOnStatusChange(
        { task: { id: 't1', parentId: null, status: 'doing' }, parent: null, siblings: [] },
        ctx,
      ),
    ).toEqual({ events: [], suggestions: [] });
  });
});

describe('FR-T08 子がすべて終わったら親の完了を提案する', () => {
  it('最後の子が完了したら、親の完了を提案する（自動では完了にしない）', () => {
    const outcome = rulesOnStatusChange(
      { task: child('done'), parent: parent('doing'), siblings: [child('done', 'c2')] },
      ctx,
    );
    expect(outcome).toEqual({
      events: [],
      suggestions: [{ kind: 'complete_parent', parentId: 'p1' }],
    });
  });

  it('完了と中止が混ざっていても、すべて終わっていれば提案する', () => {
    const outcome = rulesOnStatusChange(
      { task: child('cancelled'), parent: parent('doing'), siblings: [child('done', 'c2')] },
      ctx,
    );
    expect(outcome.suggestions).toEqual([{ kind: 'complete_parent', parentId: 'p1' }]);
  });

  it('終わっていない子が残っていれば提案しない', () => {
    const outcome = rulesOnStatusChange(
      { task: child('done'), parent: parent('doing'), siblings: [child('waiting', 'c2')] },
      ctx,
    );
    expect(outcome.suggestions).toEqual([]);
  });

  it.each(['done', 'cancelled'] as const)('親がすでに %s なら提案しない', (status) => {
    const outcome = rulesOnStatusChange(
      { task: child('done'), parent: parent(status), siblings: [] },
      ctx,
    );
    expect(outcome.suggestions).toEqual([]);
  });

  it('変えた子がまだ終わっていなければ提案しない', () => {
    const outcome = rulesOnStatusChange(
      { task: child('paused'), parent: parent('doing'), siblings: [child('done', 'c2')] },
      ctx,
    );
    expect(outcome).toEqual({ events: [], suggestions: [] });
  });
});
