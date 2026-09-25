import { describe, expect, it } from 'vitest';
import { blankDaysSince, carryoverBaseDay, carryoverCandidates, statusSpans } from './carryover';
import type { TaskEvent } from './taskEvents';

const TODAY = '2026-09-25';
const at = '2026-09-20T01:00:00.000Z';

describe('FR-D09 持ち越しの基準日', () => {
  it('前日に計画があれば、前日が基準日', () => {
    expect(carryoverBaseDay(['2026-09-20', '2026-09-24'], TODAY)).toBe('2026-09-24');
  });

  it('アプリを開かなかった日があれば、計画がある最後の日（3日前）が基準日', () => {
    const base = carryoverBaseDay(['2026-09-18', '2026-09-22'], TODAY);
    expect(base).toBe('2026-09-22');
    expect(blankDaysSince('2026-09-22', TODAY)).toBe(2);
  });

  it('前日が基準日なら、空白日は 0 日', () => {
    expect(blankDaysSince('2026-09-24', TODAY)).toBe(0);
  });

  it('計画が一度もなければ、基準日はない', () => {
    expect(carryoverBaseDay([], TODAY)).toBeNull();
  });

  it('今日と未来の計画は基準日にしない', () => {
    expect(carryoverBaseDay(['2026-09-25', '2026-09-26'], TODAY)).toBeNull();
  });

  it('「明日へ」で移した先の日を開かなかった場合も、その日が基準日になりタスクが漏れない', () => {
    // 9/22 に「明日へ」で 9/23 に移したが、9/23 と 9/24 はアプリを開かなかった
    const base = carryoverBaseDay(['2026-09-22', '2026-09-23'], TODAY);
    expect(base).toBe('2026-09-23');
    expect(carryoverCandidates([{ taskId: 'moved', status: 'todo' }], [])).toEqual([
      { taskId: 'moved', status: 'todo' },
    ]);
    expect(blankDaysSince('2026-09-23', TODAY)).toBe(1);
  });
});

describe('FR-D03 持ち越し候補', () => {
  it('基準日の計画にあって未完了で、今日の計画にまだないタスクを、計画の順に返す', () => {
    expect(
      carryoverCandidates(
        [
          { taskId: 'a', status: 'doing' },
          { taskId: 'b', status: 'done' },
          { taskId: 'c', status: 'cancelled' },
          { taskId: 'd', status: 'paused' },
          { taskId: 'e', status: 'waiting' },
          { taskId: 'f', status: 'todo' },
        ],
        ['e'],
      ).map((t) => t.taskId),
    ).toEqual(['a', 'd', 'f']);
  });
});

describe('FR-D09 状態の区間は空白日で途切れない', () => {
  const ev = (e: Partial<TaskEvent> & Pick<TaskEvent, 'type' | 'day'>) =>
    ({ taskId: 't1', at, ...e }) as TaskEvent;

  it('空白日のあいだも着手中が続き、1本の区間になる', () => {
    const events = [
      ev({ type: 'created', day: '2026-09-18' }),
      ev({ type: 'status_changed', day: '2026-09-19', from: 'todo', to: 'doing' }),
      // 9/20〜9/23 はアプリを開かなかった
      ev({ type: 'status_changed', day: '2026-09-24', from: 'doing', to: 'done' }),
    ];
    expect(statusSpans(events, TODAY)).toEqual([
      { status: 'todo', from: '2026-09-18', to: '2026-09-18' },
      { status: 'doing', from: '2026-09-19', to: '2026-09-23' },
      { status: 'done', from: '2026-09-24', to: TODAY },
    ]);
  });

  it('同じ日のうちに変わった状態は、区間にしない', () => {
    const events = [
      ev({ type: 'created', day: '2026-09-24' }),
      ev({ type: 'status_changed', day: '2026-09-24', from: 'todo', to: 'doing' }),
    ];
    expect(statusSpans(events, TODAY)).toEqual([
      { status: 'doing', from: '2026-09-24', to: TODAY },
    ]);
  });

  it('完了の取り消しも状態の変化として区間を分ける', () => {
    const events = [
      ev({ type: 'created', day: '2026-09-20' }),
      ev({ type: 'status_changed', day: '2026-09-21', from: 'todo', to: 'doing' }),
      ev({ type: 'status_changed', day: '2026-09-22', from: 'doing', to: 'done' }),
      ev({ type: 'completion_undone', day: '2026-09-23', from: 'done', to: 'doing' }),
    ];
    expect(statusSpans(events, TODAY).map((s) => s.status)).toEqual([
      'todo',
      'doing',
      'done',
      'doing',
    ]);
  });

  it('計画や編集のイベントは区間を分けない', () => {
    const events = [
      ev({ type: 'created', day: '2026-09-20' }),
      ev({ type: 'planned', day: '2026-09-21' }),
      ev({ type: 'edited', day: '2026-09-22' }),
    ];
    expect(statusSpans(events, TODAY)).toEqual([{ status: 'todo', from: '2026-09-20', to: TODAY }]);
  });

  it('月末をまたぐ区間も、前日を正しく求める', () => {
    const events = [
      ev({ type: 'created', day: '2026-09-29' }),
      ev({ type: 'status_changed', day: '2026-10-01', from: 'todo', to: 'doing' }),
    ];
    expect(statusSpans(events, '2026-10-02')[0]).toEqual({
      status: 'todo',
      from: '2026-09-29',
      to: '2026-09-30',
    });
  });
});
