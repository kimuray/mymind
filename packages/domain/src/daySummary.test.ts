import { describe, expect, it } from 'vitest';
import { summarizeDay } from './daySummary';
import type { Status } from './status';
import type { TaskEvent } from './taskEvents';

const DAY = '2026-09-22';

const created = (day: string): TaskEvent => ({
  type: 'created',
  taskId: 't',
  at: `${day}T00:00:00.000Z`,
  day,
});
const changed = (day: string, from: Status, to: Status): TaskEvent => ({
  type: 'status_changed',
  taskId: 't',
  at: `${day}T01:00:00.000Z`,
  day,
  from,
  to,
});
const planned = (day: string): TaskEvent => ({
  type: 'planned',
  taskId: 't',
  at: `${day}T00:30:00.000Z`,
  day,
});

const summarize = (events: TaskEvent[], day = DAY) =>
  summarizeDay(day, [{ taskId: 't', title: '企画書', events }]);

describe('FR-D07 その日の記録のまとめ：完了', () => {
  it('その日に完了にしたタスクを完了に数える', () => {
    const s = summarize([
      created('2026-09-20'),
      changed('2026-09-21', 'todo', 'doing'),
      changed(DAY, 'doing', 'done'),
    ]);
    expect(s.completed).toEqual([{ taskId: 't', title: '企画書' }]);
    expect(s.started).toEqual([]);
    expect(s.changes).toEqual([]);
  });

  it('前の日に完了にしたタスクは数えない', () => {
    const s = summarize([
      created('2026-09-20'),
      changed('2026-09-21', 'todo', 'doing'),
      changed('2026-09-21', 'doing', 'done'),
    ]);
    expect(s).toEqual({ completed: [], started: [], changes: [] });
  });

  it('その日のうちに完了を取り消したタスクは、完了に数えない', () => {
    const s = summarize([
      created('2026-09-20'),
      changed('2026-09-21', 'todo', 'doing'),
      changed(DAY, 'doing', 'done'),
      {
        type: 'completion_undone',
        taskId: 't',
        at: `${DAY}T02:00:00.000Z`,
        day: DAY,
        from: 'done',
        to: 'doing',
      },
    ]);
    expect(s.completed).toEqual([]);
    expect(s.started).toEqual([{ taskId: 't', title: '企画書', isNew: true, dayOrdinal: 1 }]);
  });
});

describe('FR-D07 その日の記録のまとめ：着手', () => {
  it('その日に着手したタスクは「新規」', () => {
    const s = summarize([created(DAY), changed(DAY, 'todo', 'doing')]);
    expect(s.started).toEqual([{ taskId: 't', title: '企画書', isNew: true, dayOrdinal: 1 }]);
  });

  it('前から着手中のタスクは、着手した日を1日目として数える', () => {
    const s = summarize([
      created('2026-09-19'),
      changed('2026-09-20', 'todo', 'doing'),
      planned(DAY),
    ]);
    expect(s.started).toEqual([{ taskId: 't', title: '企画書', isNew: false, dayOrdinal: 3 }]);
  });

  it('月末をまたいでも暦日で数える', () => {
    const s = summarize(
      [created('2026-09-29'), changed('2026-09-29', 'todo', 'doing')],
      '2026-10-01',
    );
    expect(s.started[0]?.dayOrdinal).toBe(3);
  });

  it('その日より後のイベントは使わない（過去の日のまとめ）', () => {
    const s = summarize([
      created('2026-09-20'),
      changed('2026-09-21', 'todo', 'doing'),
      changed('2026-09-23', 'doing', 'done'),
    ]);
    expect(s.started).toEqual([{ taskId: 't', title: '企画書', isNew: false, dayOrdinal: 2 }]);
    expect(s.completed).toEqual([]);
  });
});

describe('FR-D07 その日の記録のまとめ：変化', () => {
  it('完了・着手以外の状態変化は、その日の始めと終わりの状態を出す', () => {
    const s = summarize([
      created('2026-09-20'),
      changed('2026-09-21', 'todo', 'doing'),
      changed(DAY, 'doing', 'paused'),
    ]);
    expect(s.changes).toEqual([
      { kind: 'changed', taskId: 't', title: '企画書', from: 'doing', to: 'paused' },
    ]);
  });

  it('その日のうちに元の状態に戻ったタスクは出さない', () => {
    const s = summarize([
      created('2026-09-20'),
      changed('2026-09-21', 'todo', 'doing'),
      changed('2026-09-21', 'doing', 'waiting'),
      changed(DAY, 'waiting', 'doing'),
      changed(DAY, 'doing', 'waiting'),
    ]);
    expect(s.changes).toEqual([]);
  });

  it('待ちが3日以上続いているタスクは「待ちが継続」として出す', () => {
    const s = summarize([
      created('2026-09-18'),
      changed('2026-09-18', 'todo', 'doing'),
      changed('2026-09-18', 'doing', 'waiting'),
    ]);
    expect(s.changes).toEqual([
      { kind: 'waiting_continues', taskId: 't', title: '企画書', dayOrdinal: 5 },
    ]);
  });

  it('待ちが2日目までのタスクは出さず、3日目から出す', () => {
    const events = [
      created('2026-09-20'),
      changed('2026-09-20', 'todo', 'doing'),
      changed('2026-09-20', 'doing', 'waiting'),
    ];
    expect(summarize(events, '2026-09-21').changes).toEqual([]);
    expect(summarize(events, '2026-09-22').changes).toEqual([
      { kind: 'waiting_continues', taskId: 't', title: '企画書', dayOrdinal: 3 },
    ]);
  });

  it('その日に作っただけのタスクや、その日より後に作ったタスクは出さない', () => {
    expect(summarize([created(DAY)])).toEqual({ completed: [], started: [], changes: [] });
    expect(summarize([created('2026-09-23')])).toEqual({ completed: [], started: [], changes: [] });
  });

  it('その日に作って中断したタスクは、未着手からの変化として出す', () => {
    const s = summarize([
      created(DAY),
      changed(DAY, 'todo', 'doing'),
      changed(DAY, 'doing', 'paused'),
    ]);
    expect(s.changes).toEqual([
      { kind: 'changed', taskId: 't', title: '企画書', from: 'todo', to: 'paused' },
    ]);
  });
});
