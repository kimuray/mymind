import { describe, expect, it } from 'vitest';
import type { MonthDay } from '../api/calendar';
import {
  cellLabel,
  formatDayTitle,
  formatMonthHeading,
  leadingBlanks,
  shiftMonth,
} from './CalendarPage';

const day = (extra: Partial<MonthDay> = {}): MonthDay => ({
  day: '2026-09-05',
  isFuture: false,
  isBlank: false,
  completedCount: 0,
  hasReflection: false,
  hasFeedback: false,
  condition: null,
  ...extra,
});

describe('FR-R04 カレンダーの表示', () => {
  it('月の見出しを「2026年9月」の形にする', () => {
    expect(formatMonthHeading('2026-09')).toBe('2026年9月');
  });

  it('前後の月へ、年をまたいで移る', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });

  it('月曜始まりの表で、1日の前に置く空きを数える', () => {
    // 2026-09-01 は火曜、2026-11-01 は日曜、2027-02-01 は月曜
    expect(leadingBlanks('2026-09')).toBe(1);
    expect(leadingBlanks('2026-11')).toBe(6);
    expect(leadingBlanks('2027-02')).toBe(0);
  });

  it('日付の見出しを「9月5日（土）」の形にする', () => {
    expect(formatDayTitle('2026-09-05')).toBe('9月5日（土）');
  });
});

describe('FR-A09 NFR-06 日のマスの読み上げ名', () => {
  it('調子と完了件数を文字でも伝え、手で直した調子を優先する', () => {
    expect(cellLabel(day({ condition: { aiLevel: 3, userLevel: 1 }, completedCount: 2 }))).toBe(
      '9月5日（土） 調子：不調 完了2',
    );
  });

  it('FB のない日は「FBなし」、空白日は「記録なし」、先の日は「まだ来ていない日」と伝える', () => {
    expect(cellLabel(day())).toBe('9月5日（土） FBなし');
    expect(cellLabel(day({ isBlank: true }))).toBe('9月5日（土） 記録なし');
    expect(cellLabel(day({ isFuture: true }))).toBe('9月5日（土） まだ来ていない日');
  });
});
