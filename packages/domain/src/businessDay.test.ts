import { describe, expect, it } from 'vitest';
import { toBusinessDay } from './businessDay';

const tokyo5 = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };

describe('FR-D01 業務日', () => {
  it('切り替え時刻の直前（4:59:59）は前日の業務日になる', () => {
    // JST 2026-09-23 04:59:59
    expect(toBusinessDay(new Date('2026-09-22T19:59:59Z'), tokyo5)).toBe('2026-09-22');
  });

  it('切り替え時刻ちょうど（5:00:00）は当日の業務日になる', () => {
    // JST 2026-09-23 05:00:00
    expect(toBusinessDay(new Date('2026-09-22T20:00:00Z'), tokyo5)).toBe('2026-09-23');
  });

  it('日中の時刻はそのままの日付になる', () => {
    // JST 2026-09-22 13:10
    expect(toBusinessDay(new Date('2026-09-22T04:10:00Z'), tokyo5)).toBe('2026-09-22');
  });

  it('月末の深夜は前月の最終日になる', () => {
    // JST 2026-10-01 03:00
    expect(toBusinessDay(new Date('2026-09-30T18:00:00Z'), tokyo5)).toBe('2026-09-30');
  });

  it('元日の深夜は前年の大晦日になる', () => {
    // JST 2027-01-01 04:30
    expect(toBusinessDay(new Date('2026-12-31T19:30:00Z'), tokyo5)).toBe('2026-12-31');
  });

  it('切り替え時刻を0時にすると通常の日付と一致する', () => {
    const opts = { timeZone: 'Asia/Tokyo', dayStartHour: 0 };
    // JST 2026-09-23 00:00
    expect(toBusinessDay(new Date('2026-09-22T15:00:00Z'), opts)).toBe('2026-09-23');
  });

  it('切り替え時刻を変更できる（3時切り替えなら 4:00 は当日）', () => {
    const opts = { timeZone: 'Asia/Tokyo', dayStartHour: 3 };
    // JST 2026-09-23 04:00
    expect(toBusinessDay(new Date('2026-09-22T19:00:00Z'), opts)).toBe('2026-09-23');
  });

  it.each([-1, 24, 1.5])('切り替え時刻が不正（%s）なら例外を投げる', (hour) => {
    expect(() => toBusinessDay(new Date(), { timeZone: 'Asia/Tokyo', dayStartHour: hour })).toThrow(
      RangeError,
    );
  });

  it('不正な日時なら例外を投げる', () => {
    expect(() => toBusinessDay(new Date('invalid'), tokyo5)).toThrow(RangeError);
  });
});
