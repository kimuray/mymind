import { describe, expect, it } from 'vitest';
import { planMorning } from './morningPlan';
import type { Status } from './status';

const TODAY = '2026-09-23';
const AT = '2026-09-23T00:00:00.000Z';
const task = (id: string, status: Status) => ({ id, parentId: null, status });

const run = (input: Partial<Parameters<typeof planMorning>[0]>) =>
  planMorning({ today: TODAY, at: AT, carryovers: [], additions: [], ...input });

describe('FR-D03 持ち越しの判断', () => {
  it('「今日もやる」は今日の計画に入れる', () => {
    const r = run({
      carryovers: [{ task: task('a', 'doing'), plannedDays: ['2026-09-20'], decision: 'today' }],
    });
    expect(r).toEqual({
      ok: true,
      value: [
        {
          taskId: 'a',
          events: [{ type: 'planned', taskId: 'a', at: AT, day: TODAY }],
          plan: { removeDays: [], addDay: TODAY },
        },
      ],
    });
  });

  it('「バックログへ」は計画を動かさず、着手中なら中断にする（FR-T06）', () => {
    const r = run({
      carryovers: [
        { task: task('a', 'doing'), plannedDays: ['2026-09-22'], decision: 'backlog' },
        { task: task('b', 'todo'), plannedDays: ['2026-09-22'], decision: 'backlog' },
      ],
    });
    expect(r).toEqual({
      ok: true,
      value: [
        {
          taskId: 'a',
          events: [
            {
              type: 'status_changed',
              taskId: 'a',
              at: AT,
              day: TODAY,
              from: 'doing',
              to: 'paused',
            },
          ],
          plan: null,
        },
      ],
    });
  });

  it('「実は終わった」は、着手中・中断・待ちのタスクをそのまま完了にする', () => {
    const r = run({
      carryovers: (['doing', 'paused', 'waiting'] as const).map((s) => ({
        task: task(s, s),
        plannedDays: ['2026-09-22'],
        decision: 'done' as const,
      })),
    });
    const transitions = r.ok
      ? r.value.map((c) =>
          c.events.map((e) => (e.type === 'status_changed' ? `${e.from}→${e.to}` : e.type)),
        )
      : [];
    expect(transitions).toEqual([['doing→done'], ['paused→done'], ['waiting→done']]);
  });

  it('「実は終わった」は、未着手のタスクを着手中を経て完了にする（同じ時刻の2つのイベント）', () => {
    const r = run({
      carryovers: [{ task: task('a', 'todo'), plannedDays: ['2026-09-22'], decision: 'done' }],
    });
    expect(r).toEqual({
      ok: true,
      value: [
        {
          taskId: 'a',
          events: [
            { type: 'status_changed', taskId: 'a', at: AT, day: TODAY, from: 'todo', to: 'doing' },
            { type: 'status_changed', taskId: 'a', at: AT, day: TODAY, from: 'doing', to: 'done' },
          ],
          plan: null,
        },
      ],
    });
  });

  it('完了・中止のタスクは「実は終わった」にできない', () => {
    const r = run({
      carryovers: [{ task: task('a', 'cancelled'), plannedDays: [], decision: 'done' }],
    });
    expect(r).toEqual({
      ok: false,
      error: { kind: 'cannot_complete', taskId: 'a', status: 'cancelled' },
    });
  });
});

describe('FR-D04 バックログからの追加', () => {
  it('バックログのタスクを今日の計画に入れる', () => {
    const r = run({ additions: [{ task: task('x', 'todo'), plannedDays: [] }] });
    expect(r.ok && r.value).toEqual([
      {
        taskId: 'x',
        events: [{ type: 'planned', taskId: 'x', at: AT, day: TODAY }],
        plan: { removeDays: [], addDay: TODAY },
      },
    ]);
  });
});
