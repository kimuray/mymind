import { describe, expect, it } from 'vitest';
import { dayOrdinalSince, daysBetween, statusSinceDay } from './taskDays';
import type { TaskEvent } from './taskEvents';

const at = '2026-09-23T01:00:00.000Z';

describe('FR-T12 着手から何日目か', () => {
  it('その状態になった日を1日目として数える', () => {
    expect(dayOrdinalSince('2026-09-23', '2026-09-23')).toBe(1);
    expect(dayOrdinalSince('2026-09-20', '2026-09-22')).toBe(3);
  });

  it('月末と年末をまたいでも暦日で数える', () => {
    expect(dayOrdinalSince('2026-09-30', '2026-10-01')).toBe(2);
    expect(dayOrdinalSince('2026-12-31', '2027-01-02')).toBe(3);
  });

  it('日付が逆転していても1日目より小さくしない', () => {
    expect(dayOrdinalSince('2026-09-24', '2026-09-23')).toBe(1);
  });

  it('2つの業務日の差を数える', () => {
    expect(daysBetween('2026-09-20', '2026-09-23')).toBe(3);
    expect(daysBetween('2026-09-23', '2026-09-20')).toBe(-3);
  });

  it('業務日の形式でなければ例外にする', () => {
    expect(() => daysBetween('2026/09/20', '2026-09-23')).toThrow(RangeError);
  });
});

describe('FR-T12 今の状態になった日', () => {
  const ev = (e: Partial<TaskEvent> & Pick<TaskEvent, 'type' | 'day'>) =>
    ({ taskId: 't1', at, ...e }) as TaskEvent;

  it('最後のステータス変更の業務日を返す', () => {
    expect(
      statusSinceDay([
        ev({ type: 'created', day: '2026-09-18' }),
        ev({ type: 'status_changed', day: '2026-09-20', from: 'todo', to: 'doing' }),
        ev({ type: 'planned', day: '2026-09-22' }),
        ev({ type: 'edited', day: '2026-09-23' }),
      ]),
    ).toBe('2026-09-20');
  });

  it('ステータスを変えていなければ作成の業務日を返す', () => {
    expect(
      statusSinceDay([
        ev({ type: 'created', day: '2026-09-18' }),
        ev({ type: 'planned', day: '2026-09-19' }),
      ]),
    ).toBe('2026-09-18');
  });

  it('完了の取り消しも状態の変化として数える', () => {
    expect(
      statusSinceDay([
        ev({ type: 'created', day: '2026-09-18' }),
        ev({ type: 'completion_undone', day: '2026-09-21', from: 'done', to: 'todo' }),
      ]),
    ).toBe('2026-09-21');
  });

  it('イベントがなければ null', () => {
    expect(statusSinceDay([])).toBeNull();
  });
});
