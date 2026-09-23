import { describe, expect, it } from 'vitest';
import { canHaveChildren, nextDay, planMove } from './plans';

const at = '2026-09-23T01:00:00.000Z';
const base = { taskId: 't1', today: '2026-09-23', at };
const ev = (type: 'planned' | 'unplanned') => ({ type, taskId: 't1', at, day: '2026-09-23' });

describe('FR-T05 今日・明日・バックログへの移動', () => {
  it('どの計画にもないタスクを今日へ移すと、今日の計画に入れる', () => {
    expect(planMove({ ...base, plannedDays: [], target: 'today' })).toEqual({
      removeDays: [],
      addDay: '2026-09-23',
      events: [ev('planned')],
    });
  });

  it('今日の計画にあるタスクを明日へ移すと、今日から外して明日に入れる', () => {
    expect(planMove({ ...base, plannedDays: ['2026-09-23'], target: 'tomorrow' })).toEqual({
      removeDays: ['2026-09-23'],
      addDay: '2026-09-24',
      events: [ev('unplanned'), ev('planned')],
    });
  });

  it('バックログへ移すと、今日以降の計画から外すだけで、過去の計画は残す', () => {
    expect(
      planMove({ ...base, plannedDays: ['2026-09-20', '2026-09-23'], target: 'backlog' }),
    ).toEqual({ removeDays: ['2026-09-23'], addDay: null, events: [ev('unplanned')] });
  });

  it('すでに移す先の計画に入っていれば、何も変えない', () => {
    expect(planMove({ ...base, plannedDays: ['2026-09-23'], target: 'today' })).toEqual({
      removeDays: [],
      addDay: null,
      events: [],
    });
  });

  it('バックログにあるタスクをバックログへ移しても、何も変えない', () => {
    expect(planMove({ ...base, plannedDays: ['2026-09-20'], target: 'backlog' })).toEqual({
      removeDays: [],
      addDay: null,
      events: [],
    });
  });
});

describe('FR-T05 翌日の計算', () => {
  it.each([
    ['2026-09-23', '2026-09-24'],
    ['2026-09-30', '2026-10-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-28', '2028-02-29'],
  ])('%s の翌日は %s', (day, expected) => {
    expect(nextDay(day)).toBe(expected);
  });

  it('業務日の形式でなければ例外にする', () => {
    expect(() => nextDay('2026-09')).toThrow(RangeError);
  });
});

describe('FR-T02 親子は2階層まで', () => {
  it('親を持たないタスクは子を持てる', () => {
    expect(canHaveChildren({ parentId: null })).toBe(true);
  });

  it('子タスクは子を持てない（3階層目は作れない）', () => {
    expect(canHaveChildren({ parentId: 'p1' })).toBe(false);
  });
});
