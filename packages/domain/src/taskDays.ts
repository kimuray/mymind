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
