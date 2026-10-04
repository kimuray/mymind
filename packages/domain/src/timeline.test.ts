import { describe, expect, it } from 'vitest';
import type { Status } from './status';
import type { TaskEvent } from './taskEvents';
import { timelineBreakdown, timelineSegments } from './timeline';

const at = '2026-09-23T01:00:00.000Z';
const created = (day: string): TaskEvent => ({ type: 'created', taskId: 't', at, day });
const change = (day: string, from: Status, to: Status): TaskEvent =>
  from === 'done' && (to === 'todo' || to === 'doing')
    ? { type: 'completion_undone', taskId: 't', at, day, from, to }
    : { type: 'status_changed', taskId: 't', at, day, from, to };

describe('FR-R01 タイムラインの区間', () => {
  it('状態ごとに連続した日を1本の区間にまとめる', () => {
    const events = [
      created('2026-09-08'),
      change('2026-09-09', 'todo', 'doing'),
      change('2026-09-11', 'doing', 'paused'),
      change('2026-09-15', 'paused', 'doing'),
      change('2026-09-17', 'doing', 'waiting'),
    ];
    expect(timelineSegments(events, { from: '2026-09-09', to: '2026-09-22' })).toEqual([
      {
        status: 'doing',
        from: '2026-09-09',
        to: '2026-09-10',
        continuesBefore: false,
        continuesAfter: false,
      },
      {
        status: 'paused',
        from: '2026-09-11',
        to: '2026-09-14',
        continuesBefore: false,
        continuesAfter: false,
      },
      {
        status: 'doing',
        from: '2026-09-15',
        to: '2026-09-16',
        continuesBefore: false,
        continuesAfter: false,
      },
      {
        status: 'waiting',
        from: '2026-09-17',
        to: '2026-09-22',
        continuesBefore: false,
        continuesAfter: true,
      },
    ]);
  });

  it('未着手と中止の日は描かない', () => {
    const events = [
      created('2026-09-09'),
      change('2026-09-11', 'todo', 'doing'),
      change('2026-09-12', 'doing', 'cancelled'),
    ];
    expect(timelineSegments(events, { from: '2026-09-09', to: '2026-09-15' })).toEqual([
      {
        status: 'doing',
        from: '2026-09-11',
        to: '2026-09-11',
        continuesBefore: false,
        continuesAfter: false,
      },
    ]);
  });

  it('完了したタスクは、着手から完了までを完了したタスクの期間として描き、完了の後の日は描かない', () => {
    const events = [
      created('2026-09-09'),
      change('2026-09-10', 'todo', 'doing'),
      change('2026-09-12', 'doing', 'done'),
    ];
    expect(timelineSegments(events, { from: '2026-09-09', to: '2026-09-15' })).toEqual([
      {
        status: 'done',
        from: '2026-09-10',
        to: '2026-09-12',
        continuesBefore: false,
        continuesAfter: false,
      },
    ]);
  });

  it('完了したタスクでも、中断と待ちの区間はそのまま描き分ける', () => {
    const events = [
      created('2026-09-11'),
      change('2026-09-11', 'todo', 'doing'),
      change('2026-09-12', 'doing', 'waiting'),
      change('2026-09-17', 'waiting', 'done'),
    ];
    expect(
      timelineSegments(events, { from: '2026-09-09', to: '2026-09-22' }).map((s) => [
        s.status,
        s.from,
        s.to,
      ]),
    ).toEqual([
      ['done', '2026-09-11', '2026-09-11'],
      ['waiting', '2026-09-12', '2026-09-16'],
      ['done', '2026-09-17', '2026-09-17'],
    ]);
  });

  it('表示期間の後に完了したタスクは、期間の中では着手中として描く', () => {
    const events = [
      created('2026-09-09'),
      change('2026-09-09', 'todo', 'doing'),
      change('2026-09-20', 'doing', 'done'),
    ];
    expect(
      timelineSegments(events, { from: '2026-09-09', to: '2026-09-15' }).map((s) => s.status),
    ).toEqual(['doing']);
  });

  it('同じ日に何度変わっても、その日の最後の状態で描く', () => {
    const events = [
      created('2026-09-22'),
      change('2026-09-22', 'todo', 'doing'),
      change('2026-09-22', 'doing', 'done'),
    ];
    expect(timelineSegments(events, { from: '2026-09-20', to: '2026-09-22' })).toEqual([
      {
        status: 'done',
        from: '2026-09-22',
        to: '2026-09-22',
        continuesBefore: false,
        continuesAfter: false,
      },
    ]);
  });

  it('表示期間の前から続く区間は初日で切り、続いていることを示す', () => {
    const events = [created('2026-09-01'), change('2026-09-03', 'todo', 'doing')];
    expect(timelineSegments(events, { from: '2026-09-09', to: '2026-09-15' })).toEqual([
      {
        status: 'doing',
        from: '2026-09-09',
        to: '2026-09-15',
        continuesBefore: true,
        continuesAfter: true,
      },
    ]);
  });

  it('表示期間の末日で状態が変わるなら、続いているとしない', () => {
    const events = [
      created('2026-09-09'),
      change('2026-09-09', 'todo', 'doing'),
      change('2026-09-16', 'doing', 'waiting'),
    ];
    expect(timelineSegments(events, { from: '2026-09-09', to: '2026-09-15' })).toEqual([
      {
        status: 'doing',
        from: '2026-09-09',
        to: '2026-09-15',
        continuesBefore: false,
        continuesAfter: false,
      },
    ]);
  });

  it('イベントのない空白日をまたいでも区間を途切れさせない', () => {
    const events = [
      created('2026-09-20'),
      change('2026-09-20', 'todo', 'doing'),
      change('2026-09-24', 'doing', 'waiting'),
    ];
    expect(timelineSegments(events, { from: '2026-09-20', to: '2026-09-27' })).toEqual([
      {
        status: 'doing',
        from: '2026-09-20',
        to: '2026-09-23',
        continuesBefore: false,
        continuesAfter: false,
      },
      {
        status: 'waiting',
        from: '2026-09-24',
        to: '2026-09-27',
        continuesBefore: false,
        continuesAfter: true,
      },
    ]);
  });

  it('月末と年末をまたぐ期間を暦日で並べる', () => {
    const events = [created('2026-12-30'), change('2026-12-30', 'todo', 'doing')];
    expect(timelineSegments(events, { from: '2026-12-28', to: '2027-01-03' })).toEqual([
      {
        status: 'doing',
        from: '2026-12-30',
        to: '2027-01-03',
        continuesBefore: false,
        continuesAfter: true,
      },
    ]);
  });

  it('完了を取り消して着手中に戻すと、取り消した日から着手中を描く', () => {
    const events = [
      created('2026-09-09'),
      change('2026-09-09', 'todo', 'doing'),
      change('2026-09-10', 'doing', 'done'),
      change('2026-09-12', 'done', 'doing'),
    ];
    expect(
      timelineSegments(events, { from: '2026-09-09', to: '2026-09-13' }).map((s) => [
        s.status,
        s.from,
        s.to,
      ]),
    ).toEqual([
      ['doing', '2026-09-09', '2026-09-09'],
      ['done', '2026-09-10', '2026-09-10'],
      ['doing', '2026-09-12', '2026-09-13'],
    ]);
  });

  it('作成より前の期間や、イベントがないタスクは何も描かない', () => {
    expect(timelineSegments([], { from: '2026-09-09', to: '2026-09-15' })).toEqual([]);
    expect(
      timelineSegments([created('2026-09-20')], { from: '2026-09-09', to: '2026-09-15' }),
    ).toEqual([]);
  });
});

describe('FR-R03 タイムラインの内訳', () => {
  it('着手中・中断・待ちの日数を暦日で数え、完了した日は着手中に数える', () => {
    const events = [
      created('2026-09-10'),
      change('2026-09-11', 'todo', 'doing'),
      change('2026-09-12', 'doing', 'waiting'),
      change('2026-09-17', 'waiting', 'done'),
    ];
    expect(timelineBreakdown(events, '2026-09-22')).toEqual({
      doing: 2,
      paused: 0,
      waiting: 5,
      startedDay: '2026-09-11',
      completedDay: '2026-09-17',
    });
  });

  it('続いているタスクは今日まで数え、完了の日は持たない', () => {
    const events = [
      created('2026-09-09'),
      change('2026-09-09', 'todo', 'doing'),
      change('2026-09-11', 'doing', 'paused'),
      change('2026-09-15', 'paused', 'doing'),
    ];
    expect(timelineBreakdown(events, '2026-09-22')).toEqual({
      doing: 10,
      paused: 4,
      waiting: 0,
      startedDay: '2026-09-09',
      completedDay: null,
    });
  });

  it('同じ日に着手して完了したら、着手中1日で完了とする', () => {
    const events = [
      created('2026-09-22'),
      change('2026-09-22', 'todo', 'doing'),
      change('2026-09-22', 'doing', 'done'),
    ];
    expect(timelineBreakdown(events, '2026-09-24')).toEqual({
      doing: 1,
      paused: 0,
      waiting: 0,
      startedDay: '2026-09-22',
      completedDay: '2026-09-22',
    });
  });

  it('着手していないタスクは0日で、着手した日を持たない', () => {
    expect(timelineBreakdown([created('2026-09-20')], '2026-09-22')).toEqual({
      doing: 0,
      paused: 0,
      waiting: 0,
      startedDay: null,
      completedDay: null,
    });
    expect(timelineBreakdown([], '2026-09-22')).toEqual({
      doing: 0,
      paused: 0,
      waiting: 0,
      startedDay: null,
      completedDay: null,
    });
  });

  it('中止したあとの日は数えない', () => {
    const events = [
      created('2026-09-20'),
      change('2026-09-20', 'todo', 'doing'),
      change('2026-09-21', 'doing', 'cancelled'),
    ];
    expect(timelineBreakdown(events, '2026-09-25')).toMatchObject({
      doing: 1,
      completedDay: null,
    });
  });

  it('完了を取り消して再び完了したら、最後に完了した日を返す', () => {
    const events = [
      created('2026-12-30'),
      change('2026-12-30', 'todo', 'doing'),
      change('2026-12-31', 'doing', 'done'),
      change('2027-01-01', 'done', 'doing'),
      change('2027-01-02', 'doing', 'done'),
    ];
    expect(timelineBreakdown(events, '2027-01-03')).toEqual({
      doing: 4,
      paused: 0,
      waiting: 0,
      startedDay: '2026-12-30',
      completedDay: '2027-01-02',
    });
  });
});
