import { describe, expect, it } from 'vitest';
import {
  buildDayRecord,
  type DayRecord,
  type DayRecordSource,
  diffDayRecords,
  isEmptyDayRecordDiff,
} from './dayRecord';
import type { Status } from './status';
import type { TaskEvent } from './taskEvents';

const DAY = '2026-09-22';
const NEXT_DAY = '2026-09-23';

const created = (taskId: string, day: string): TaskEvent => ({
  type: 'created',
  taskId,
  at: `${day}T00:00:00.000Z`,
  day,
});
const changed = (taskId: string, day: string, from: Status, to: Status): TaskEvent => ({
  type: 'status_changed',
  taskId,
  at: `${day}T01:00:00.000Z`,
  day,
  from,
  to,
});

const source = (
  taskId: string,
  events: TaskEvent[],
  extra: Partial<DayRecordSource> = {},
): DayRecordSource => ({
  taskId,
  title: `タスク${taskId}`,
  parentTitle: null,
  tags: [],
  events,
  ...extra,
});

const build = (sources: DayRecordSource[], day = DAY) =>
  buildDayRecord(
    day,
    sources,
    sources.map((s) => ({ taskId: s.taskId, title: s.title, events: s.events })),
  );

describe('FR-R07 その日の記録をイベントから作る', () => {
  it('計画のタスクを、その日の終わりの状態と、その状態になってからの日数で記録する', () => {
    const record = build([
      source('a', [created('a', '2026-09-20'), changed('a', '2026-09-21', 'todo', 'doing')]),
    ]);
    expect(record.tasks).toEqual([
      {
        taskId: 'a',
        title: 'タスクa',
        parentTitle: null,
        status: 'doing',
        statusDays: 2,
        tags: [],
      },
    ]);
  });

  it('後の日の操作は入らない（翌日に完了にしても、その日は着手中のまま）', () => {
    const record = build([
      source('a', [
        created('a', DAY),
        changed('a', DAY, 'todo', 'doing'),
        changed('a', NEXT_DAY, 'doing', 'done'),
      ]),
    ]);
    expect(record.tasks[0]).toMatchObject({ status: 'doing', statusDays: 1 });
    expect(record.counts).toMatchObject({ doing: 1, done: 0 });
  });

  it('同じ日に何度変わっても、その日の最後の状態を使う', () => {
    const record = build([
      source('a', [
        created('a', DAY),
        changed('a', DAY, 'todo', 'doing'),
        changed('a', DAY, 'doing', 'paused'),
      ]),
    ]);
    expect(record.tasks[0]?.status).toBe('paused');
  });

  it('その日にまだないタスクは記録に入れない', () => {
    const record = build([source('a', [created('a', NEXT_DAY)])]);
    expect(record.tasks).toEqual([]);
    expect(record.counts.planned).toBe(0);
  });

  it('件数を状態ごとに数える（未着手は計画の数にだけ入る）', () => {
    const record = build([
      source('a', [created('a', DAY)]),
      source('b', [created('b', DAY), changed('b', DAY, 'todo', 'doing')]),
      source('c', [
        created('c', DAY),
        changed('c', DAY, 'todo', 'doing'),
        changed('c', DAY, 'doing', 'done'),
      ]),
      source('d', [
        created('d', DAY),
        changed('d', DAY, 'todo', 'doing'),
        changed('d', DAY, 'doing', 'waiting'),
      ]),
    ]);
    expect(record.counts).toEqual({ planned: 4, done: 1, doing: 1, paused: 0, waiting: 1 });
  });

  it('親の名前とタグを持ち、まとめ（FR-D07）も入れる', () => {
    const record = build([
      source('a', [created('a', DAY), changed('a', DAY, 'todo', 'doing')], {
        parentTitle: '親',
        tags: ['仕事'],
      }),
    ]);
    expect(record.tasks[0]).toMatchObject({ parentTitle: '親', tags: ['仕事'] });
    expect(record.summary.started).toEqual([
      { taskId: 'a', title: 'タスクa', isNew: true, dayOrdinal: 1 },
    ]);
  });
});

describe('FR-R07 再生成の前後の差分', () => {
  const doing = build([source('a', [created('a', DAY), changed('a', DAY, 'todo', 'doing')])]);
  const done = build([
    source('a', [
      created('a', DAY),
      changed('a', DAY, 'todo', 'doing'),
      changed('a', DAY, 'doing', 'done'),
    ]),
  ]);

  it('同じ記録なら違いはない', () => {
    expect(isEmptyDayRecordDiff(diffDayRecords(doing, doing))).toBe(true);
  });

  it('状態が変わったタスク、件数、まとめの完了の違いを返す', () => {
    const diff = diffDayRecords(doing, done);
    expect(diff.tasks).toEqual([
      { kind: 'status_changed', taskId: 'a', title: 'タスクa', from: 'doing', to: 'done' },
    ]);
    expect(diff.counts).toEqual([
      { key: 'done', before: 0, after: 1 },
      { key: 'doing', before: 1, after: 0 },
    ]);
    expect(diff.completed).toEqual({ added: ['タスクa'], removed: [] });
    expect(isEmptyDayRecordDiff(diff)).toBe(false);
  });

  it('加わったタスクと、なくなったタスクを返す', () => {
    const empty = build([]);
    expect(diffDayRecords(empty, doing).tasks).toEqual([
      { kind: 'added', taskId: 'a', title: 'タスクa', status: 'doing' },
    ]);
    expect(diffDayRecords(doing, empty).tasks).toEqual([
      { kind: 'removed', taskId: 'a', title: 'タスクa', status: 'doing' },
    ]);
    expect(diffDayRecords(done, empty).completed).toEqual({ added: [], removed: ['タスクa'] });
  });

  it('名前やタグ、日数だけの違いは出さない', () => {
    const renamed: DayRecord = {
      ...doing,
      tasks: doing.tasks.map((t) => ({ ...t, title: '別の名前', tags: ['仕事'], statusDays: 9 })),
    };
    expect(isEmptyDayRecordDiff(diffDayRecords(doing, renamed))).toBe(true);
  });
});
