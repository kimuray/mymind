/**
 * 定期処理の予定（NFR-19、FR-N01〜N03、NFR-04）。時刻は利用者の地域の時刻（例：Asia/Tokyo の 8:30）で書き、
 * 次に動かす瞬間（UTC）をここで計算する。現在時刻は引数で受け取る
 */
export type ScheduleSpec = {
  /** 「HH:MM」（24時間制） */
  time: string;
  /** 曜日（0=日曜 〜 6=土曜）。省くと毎日 */
  weekday?: number;
};

/** スリープなどで過ぎた予定を、時刻を過ぎてからどれだけの間なら動かすか（architecture.md 9.1） */
export const MISSED_GRACE_MS = 2 * 60 * 60 * 1000;

const DAY_MS = 86_400_000;

/** 予定の時刻の形（「HH:MM」、00:00〜23:59）。設定の検証でも使う */
export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTime(time: string): { hour: number; minute: number } {
  const match = SCHEDULE_TIME_PATTERN.exec(time);
  if (match === null) throw new RangeError(`時刻は HH:MM で指定してください: ${time}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** その瞬間の、タイムゾーンでの年月日と曜日 */
function zonedDate(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdays.indexOf(get('weekday') ?? ''),
  };
}

/** タイムゾーンでの時差（ミリ秒、UTC より進んでいれば正） */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** タイムゾーンでの年月日と時刻を、その瞬間（UTC）にする */
function zonedInstant(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  // 時差はその瞬間で決まるので、1回目の推定の時差で直す（夏時間の切り替え日だけ1時間ずれうる）
  return new Date(guess - offsetMs(new Date(guess), timeZone));
}

/**
 * after より後で、予定に当たる最初の瞬間。after とちょうど同じ瞬間は含めない（動かした直後に同じ予定を選ばないため）
 */
export function nextOccurrence(spec: ScheduleSpec, after: Date, timeZone: string): Date {
  const { hour, minute } = parseTime(spec.time);
  if (
    spec.weekday !== undefined &&
    !(Number.isInteger(spec.weekday) && spec.weekday >= 0 && spec.weekday <= 6)
  ) {
    throw new RangeError(`曜日は 0〜6 で指定してください: ${spec.weekday}`);
  }
  const start = zonedDate(after, timeZone);
  // 今日から8日先までに、時刻と曜日の両方に当たる瞬間が必ずある
  for (let i = 0; i <= 8; i++) {
    const date = zonedDate(
      new Date(Date.UTC(start.year, start.month - 1, start.day, 12) + i * DAY_MS),
      'UTC',
    );
    if (spec.weekday !== undefined && date.weekday !== spec.weekday) continue;
    const at = zonedInstant(date, hour, minute, timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('次の予定が見つかりませんでした');
}

/**
 * 過ぎた予定を、今動かしてよいか。時刻を過ぎてから grace 以内なら動かし、それを過ぎたら見送る
 * （スリープから復帰したときなど。architecture.md 9.1）
 */
export function isWithinGrace(
  scheduledAt: Date,
  now: Date,
  graceMs: number = MISSED_GRACE_MS,
): boolean {
  const late = now.getTime() - scheduledAt.getTime();
  return late >= 0 && late <= graceMs;
}
