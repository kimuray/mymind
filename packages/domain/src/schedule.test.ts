import { describe, expect, it } from 'vitest';
import { isWithinGrace, MISSED_GRACE_MS, nextOccurrence } from './schedule';

const TZ = 'Asia/Tokyo';
/** 日本時間の日時（「2026-09-23 08:00」）を、その瞬間にする */
const jst = (s: string) => new Date(`${s.replace(' ', 'T')}:00+09:00`);

describe('NFR-19 次に動かす時刻', () => {
  it('その日の時刻がまだ来ていなければ、その日の時刻にする', () => {
    expect(nextOccurrence({ time: '08:30' }, jst('2026-09-23 08:00'), TZ)).toEqual(
      jst('2026-09-23 08:30'),
    );
  });

  it('ちょうどその時刻か過ぎていれば、翌日の時刻にする（直前と直後）', () => {
    expect(nextOccurrence({ time: '08:30' }, jst('2026-09-23 08:29'), TZ)).toEqual(
      jst('2026-09-23 08:30'),
    );
    expect(nextOccurrence({ time: '08:30' }, jst('2026-09-23 08:30'), TZ)).toEqual(
      jst('2026-09-24 08:30'),
    );
  });

  it('日本時間の日付で数える（UTC では前日でも、日本時間の当日の時刻を選ぶ）', () => {
    // 2026-09-23 01:00 JST は UTC では 9月22日
    expect(nextOccurrence({ time: '03:30' }, jst('2026-09-23 01:00'), TZ)).toEqual(
      jst('2026-09-23 03:30'),
    );
  });

  it('月末と年末をまたいで、翌月・翌年の時刻にする', () => {
    expect(nextOccurrence({ time: '21:30' }, jst('2026-09-30 22:00'), TZ)).toEqual(
      jst('2026-10-01 21:30'),
    );
    expect(nextOccurrence({ time: '08:30' }, jst('2026-12-31 09:00'), TZ)).toEqual(
      jst('2027-01-01 08:30'),
    );
  });

  it('曜日を指定したら、その曜日の時刻にする（日曜の夜の棚卸し）', () => {
    // 2026-09-23 は水曜。次の日曜は 9月27日
    expect(nextOccurrence({ time: '21:45', weekday: 0 }, jst('2026-09-23 10:00'), TZ)).toEqual(
      jst('2026-09-27 21:45'),
    );
    // 日曜の時刻を過ぎていれば、翌週の日曜
    expect(nextOccurrence({ time: '21:45', weekday: 0 }, jst('2026-09-27 21:45'), TZ)).toEqual(
      jst('2026-10-04 21:45'),
    );
    expect(nextOccurrence({ time: '21:45', weekday: 0 }, jst('2026-09-27 21:44'), TZ)).toEqual(
      jst('2026-09-27 21:45'),
    );
  });

  it('時刻や曜日の形が違えば例外にする', () => {
    const now = jst('2026-09-23 08:00');
    expect(() => nextOccurrence({ time: '8:30' }, now, TZ)).toThrow(RangeError);
    expect(() => nextOccurrence({ time: '24:00' }, now, TZ)).toThrow(RangeError);
    expect(() => nextOccurrence({ time: '08:30', weekday: 7 }, now, TZ)).toThrow(RangeError);
  });

  it('時差のないタイムゾーンでも同じ規則で計算する', () => {
    expect(
      nextOccurrence({ time: '08:30' }, new Date('2026-09-23T09:00:00Z'), 'UTC').toISOString(),
    ).toBe('2026-09-24T08:30:00.000Z');
  });
});

describe('NFR-19 スリープから復帰したときの、過ぎた予定', () => {
  const at = jst('2026-09-23 21:30');

  it('時刻を過ぎてから2時間以内なら動かす（境界を含む）', () => {
    expect(isWithinGrace(at, jst('2026-09-23 21:30'))).toBe(true);
    expect(isWithinGrace(at, new Date(at.getTime() + MISSED_GRACE_MS))).toBe(true);
  });

  it('2時間を過ぎたら見送る', () => {
    expect(isWithinGrace(at, new Date(at.getTime() + MISSED_GRACE_MS + 1))).toBe(false);
  });

  it('まだ時刻が来ていなければ動かさない', () => {
    expect(isWithinGrace(at, jst('2026-09-23 21:29'))).toBe(false);
  });
});
