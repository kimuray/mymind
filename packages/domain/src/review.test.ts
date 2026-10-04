import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVIEW_AFTER_DAYS,
  daysSinceTouched,
  isReviewTarget,
  planReviewDecision,
} from './review';

describe('FR-R06 棚卸しの対象', () => {
  it('最後に触れてからの日数を暦日で数え、月末と年末をまたいでも数える', () => {
    expect(daysSinceTouched('2026-09-01', '2026-10-01')).toBe(30);
    expect(daysSinceTouched('2026-12-15', '2027-01-14')).toBe(30);
  });

  it('今日より後に触れたことになっていても、負の日数にしない', () => {
    expect(daysSinceTouched('2026-09-24', '2026-09-23')).toBe(0);
  });

  it('ちょうど指定した日数で対象になり、1日前は対象にしない（初期値は30日）', () => {
    expect(DEFAULT_REVIEW_AFTER_DAYS).toBe(30);
    expect(isReviewTarget('2026-09-01', '2026-10-01', 30)).toBe(true);
    expect(isReviewTarget('2026-09-02', '2026-10-01', 30)).toBe(false);
  });

  it('日数の設定を変えると、その日数で判定する', () => {
    expect(isReviewTarget('2026-09-24', '2026-10-01', 7)).toBe(true);
    expect(isReviewTarget('2026-09-25', '2026-10-01', 7)).toBe(false);
  });
});

describe('FR-R06 棚卸しの判断', () => {
  it('今週やるは今日の計画に入れ、残すは触れた日時だけを更新し、中止は中止にする', () => {
    expect(planReviewDecision('this_week')).toEqual({ kind: 'move', to: 'today' });
    expect(planReviewDecision('keep')).toEqual({ kind: 'touch' });
    expect(planReviewDecision('drop')).toEqual({ kind: 'transition', to: 'cancelled' });
  });
});
