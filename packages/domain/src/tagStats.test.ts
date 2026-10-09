import { describe, expect, it } from 'vitest';
import type { Status } from './status';
import { tagStats } from './tagStats';
import type { TaskEvent } from './taskEvents';

const at = '2026-09-23T01:00:00.000Z';
const created = (day: string): TaskEvent => ({ type: 'created', taskId: 't', at, day });
const change = (day: string, from: Status, to: Status): TaskEvent =>
  from === 'done' && (to === 'todo' || to === 'doing')
    ? { type: 'completion_undone', taskId: 't', at, day, from, to }
    : { type: 'status_changed', taskId: 't', at, day, from, to };

/** 9/1 に着手し、9/3 に待ち、9/5 に着手に戻し、9/6 に完了 */
const finished = [
  created('2026-09-01'),
  change('2026-09-01', 'todo', 'doing'),
  change('2026-09-03', 'doing', 'waiting'),
  change('2026-09-05', 'waiting', 'doing'),
  change('2026-09-06', 'doing', 'done'),
];
const september = { from: '2026-09-01', to: '2026-09-30' };

describe('FR-R08 タグごとの集計', () => {
  it('完了の数と、着手中・待ちの日数を数える。完了した日は着手中に数え、完了の後は数えない', () => {
    expect(tagStats([{ tagIds: ['work'], events: finished }], september, ['work'])).toEqual([
      // 着手中：9/1, 9/2, 9/5, 9/6（完了した日）。待ち：9/3, 9/4
      { tagId: 'work', completed: 1, doingDays: 4, waitingDays: 2 },
    ]);
  });

  it('期間の外の日は数えない（月の初日の直前と、月末の翌日）', () => {
    const crossing = [
      created('2026-08-30'),
      change('2026-08-31', 'todo', 'doing'),
      change('2026-10-01', 'doing', 'done'),
    ];
    expect(tagStats([{ tagIds: ['work'], events: crossing }], september, ['work'])).toEqual([
      { tagId: 'work', completed: 0, doingDays: 30, waitingDays: 0 },
    ]);
  });

  it('月末に完了したタスクはその月に数え、翌月には数えない', () => {
    const endOfMonth = [
      created('2026-09-29'),
      change('2026-09-29', 'todo', 'doing'),
      change('2026-09-30', 'doing', 'done'),
    ];
    const october = { from: '2026-10-01', to: '2026-10-31' };
    expect(tagStats([{ tagIds: ['w'], events: endOfMonth }], september, ['w'])[0]?.completed).toBe(
      1,
    );
    expect(tagStats([{ tagIds: ['w'], events: endOfMonth }], october, ['w'])).toEqual([]);
  });

  it('完了を取り消した日は完了に数えない', () => {
    const undone = [...finished, change('2026-09-06', 'done', 'doing')];
    expect(tagStats([{ tagIds: ['w'], events: undone }], september, ['w'])[0]?.completed).toBe(0);
  });

  it('複数のタグが付いたタスクは、それぞれのタグに数える', () => {
    expect(
      tagStats([{ tagIds: ['a', 'b'], events: finished }], september, ['a', 'b']).map((s) => [
        s.tagId,
        s.completed,
      ]),
    ).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  it('タグのないタスクは「タグなし」にまとめ、最後に並べる', () => {
    const stats = tagStats(
      [
        { tagIds: [], events: finished },
        { tagIds: [], events: finished },
        { tagIds: ['work'], events: finished },
      ],
      september,
      ['work'],
    );
    expect(stats.map((s) => [s.tagId, s.completed])).toEqual([
      ['work', 1],
      [null, 2],
    ]);
  });

  it('行は渡したタグの順に並べ、どれも 0 のタグは出さない', () => {
    const todoOnly = [created('2026-09-02')];
    const stats = tagStats(
      [
        { tagIds: ['b'], events: finished },
        { tagIds: ['a'], events: finished },
        { tagIds: ['c'], events: todoOnly },
      ],
      september,
      ['a', 'b', 'c'],
    );
    expect(stats.map((s) => s.tagId)).toEqual(['a', 'b']);
  });

  it('期間がまるごと先なら空', () => {
    expect(
      tagStats([{ tagIds: ['w'], events: finished }], { from: '2026-10-01', to: '2026-09-30' }, [
        'w',
      ]),
    ).toEqual([]);
  });
});
