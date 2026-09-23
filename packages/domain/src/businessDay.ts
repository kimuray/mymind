export type BusinessDayOptions = {
  /** IANA タイムゾーン（例：Asia/Tokyo） */
  timeZone: string;
  /** 日付が切り替わる時刻（0〜23時） */
  dayStartHour: number;
};

/**
 * 時刻を業務日（YYYY-MM-DD）に変換する。
 * 切り替え時刻より前の時刻は前日の業務日に属する（例：5:00 切り替えなら 4:59 は前日）。
 * 夏時間のあるタイムゾーンでは切り替え日に1時間ずれる可能性がある（Asia/Tokyo では発生しない）。
 */
export function toBusinessDay(at: Date, options: BusinessDayOptions): string {
  const { timeZone, dayStartHour } = options;
  if (!Number.isInteger(dayStartHour) || dayStartHour < 0 || dayStartHour > 23) {
    throw new RangeError(`dayStartHour は 0〜23 の整数で指定してください: ${dayStartHour}`);
  }
  if (Number.isNaN(at.getTime())) {
    throw new RangeError('不正な日時です');
  }
  const shifted = new Date(at.getTime() - dayStartHour * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`日付の ${type} を取得できませんでした`);
    return part.value;
  };
  return `${get('year')}-${get('month')}-${get('day')}`;
}
