import type { TaskEvent } from './taskEvents';

const toUtcDays = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || [y, m, d].some(Number.isNaN)) {
    throw new RangeError(`業務日の形式ではありません: ${day}`);
  }
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * day より前の count 日の業務日を、新しい順に返す（エージェントに渡す「直近7日」、architecture.md 12.5）。
 * 暦の計算だけなのでタイムゾーンに依存しない
 */
export function previousDays(day: string, count: number): string[] {
  const base = toUtcDays(day);
  return Array.from({ length: count }, (_, i) =>
    new Date((base - i - 1) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** 2つの業務日の間の暦日の数（from が to より後なら負） */
export function daysBetween(from: string, to: string): number {
  return toUtcDays(to) - toUtcDays(from);
}

/**
 * 今のステータスになった業務日（FR-T12）。作成か、最後のステータス変更のイベントの業務日。
 * イベントは記録した順（ID の順）に並んでいること。
 */
export function statusSinceDay(events: readonly TaskEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e === undefined) continue;
    if (e.type === 'created' || e.type === 'status_changed' || e.type === 'completion_undone') {
      return e.day;
    }
  }
  return null;
}

/**
 * 「着手から何日目か」のような、その状態になってからの日数（FR-T12）。
 * 空白日を含めて暦日で数え、その日を1日目とする（architecture.md 4.5）。
 */
export function dayOrdinalSince(sinceDay: string, today: string): number {
  return Math.max(1, daysBetween(sinceDay, today) + 1);
}

/** 扱う最も古い年。記録はアプリを使い始めてからのものなので、これより前の年は扱わない */
export const MIN_YEAR = 1970;

/**
 * 月（YYYY-MM）の業務日を、1日から月末まで順に返す（FR-R04 のカレンダー）。
 * 形式が違う月や存在しない月は例外にする（入力は境界で検証してから渡す）
 */
export function daysOfMonth(ym: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  // Date.UTC は 0〜99 年を 1900 年代として扱うので、使わない年はまとめて拒否する
  if (match === null || year < MIN_YEAR || month < 1 || month > 12) {
    throw new RangeError(`月の形式ではありません: ${ym}`);
  }
  const first = `${ym}-01`;
  // 翌月の1日の前日が月末
  const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return Array.from({ length: daysBetween(first, next) }, (_, i) =>
    new Date((toUtcDays(first) + i) * 86_400_000).toISOString().slice(0, 10),
  );
}
