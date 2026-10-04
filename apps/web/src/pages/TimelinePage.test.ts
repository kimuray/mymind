import { describe, expect, it } from 'vitest';
import type { TimelineTask } from '../api/timeline';
import { formatRange, rowLabel, segmentColumns, shiftDay, spanNote } from './TimelinePage';

const breakdown = (startedDay: string | null, completedDay: string | null) =>
  ({ breakdown: { doing: 0, paused: 0, waiting: 0, startedDay, completedDay } }) as Pick<
    TimelineTask,
    'breakdown'
  >;

describe('FR-R01 タイムラインの表示', () => {
  it('前後の日へ、月末と年末をまたいで動く', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDay('2026-09-22', -13)).toBe('2026-09-09');
  });

  it('期間を「9月9日 – 9月22日」の形にする', () => {
    expect(formatRange('2026-09-09', '2026-09-22')).toBe('9月9日 – 9月22日');
  });

  it('区間を、名前の列のあとの日の列に置く（終わりの列は含まない）', () => {
    expect(segmentColumns('2026-09-09', { from: '2026-09-09', to: '2026-09-10' })).toEqual({
      start: 2,
      end: 4,
    });
    expect(segmentColumns('2026-09-09', { from: '2026-09-22', to: '2026-09-22' })).toEqual({
      start: 15,
      end: 16,
    });
  });

  it('行の読み上げ名に、横棒の状態と期間を文字で入れる', () => {
    expect(
      rowLabel({
        title: '企画書を書く',
        segments: [
          {
            status: 'doing',
            from: '2026-09-20',
            to: '2026-09-21',
            continuesBefore: false,
            continuesAfter: false,
          },
          {
            status: 'paused',
            from: '2026-09-22',
            to: '2026-09-23',
            continuesBefore: false,
            continuesAfter: true,
          },
        ],
      }),
    ).toBe('企画書を書く：着手中 9月20日 – 9月21日、中断 9月22日 – 9月23日');
  });
});

describe('FR-R03 期間の内訳の副題', () => {
  it('続いているタスクは、着手した日と何日目かを書く', () => {
    expect(spanNote(breakdown('2026-09-09', null), '2026-09-22')).toBe(
      '9月9日 着手 → 継続中（14日目）',
    );
  });

  it('完了したタスクは、完了した日と日数を書き、同じ日なら「同日完了」', () => {
    expect(spanNote(breakdown('2026-09-11', '2026-09-17'), '2026-09-22')).toBe(
      '9月11日 着手 → 9月17日 完了（7日）',
    );
    expect(spanNote(breakdown('2026-09-22', '2026-09-22'), '2026-09-22')).toBe(
      '9月22日 着手 → 同日完了',
    );
  });

  it('着手していなければ、そのことを書く', () => {
    expect(spanNote(breakdown(null, null), '2026-09-22')).toBe('まだ着手していません');
  });
});
