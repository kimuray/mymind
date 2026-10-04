import type { Status } from './status';
import { daysBetween } from './taskDays';
import type { TaskEvent } from './taskEvents';

/** タイムラインに描く状態。未着手と中止は描かない（FR-R01） */
export type TimelineStatus = 'doing' | 'paused' | 'waiting' | 'done';

/** タイムラインの横棒1本。from〜to は業務日で、両端を含む */
export type TimelineSegment = {
  status: TimelineStatus;
  from: string;
  to: string;
  /** 表示期間の初日より前から同じ状態が続いている（左端を丸めない） */
  continuesBefore: boolean;
  /** 表示期間の末日の翌日も同じ状態が続く（右端を丸めない） */
  continuesAfter: boolean;
};

/** 着手してからの日数の内訳（FR-R03）。完了した日は着手中に数える */
export type TimelineBreakdown = {
  doing: number;
  paused: number;
  waiting: number;
  /** 最初に着手した業務日。まだ着手していなければ null */
  startedDay: string | null;
  /** 完了した業務日。今が完了でなければ null */
  completedDay: string | null;
};

const DAY_MS = 86_400_000;

const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const isDrawn = (s: Status | null): s is TimelineStatus =>
  s === 'doing' || s === 'paused' || s === 'waiting' || s === 'done';

/**
 * 業務日ごとの、その日の終わりの状態を返す関数を作る。
 * 同じ日に何度変わっても、その日の最後の状態だけを使う（NFR-09：記録は業務日の単位）。
 * イベントは記録した順（ID の順）に並んでいること。作成より前の日は null
 */
function statusByDay(events: readonly TaskEvent[]): (day: string) => Status | null {
  const changes: { day: string; status: Status }[] = [];
  for (const e of events) {
    if (e.type === 'created') changes.push({ day: e.day, status: 'todo' });
    else if (e.type === 'status_changed' || e.type === 'completion_undone') {
      changes.push({ day: e.day, status: e.to });
    }
  }
  return (day) => {
    let status: Status | null = null;
    for (const c of changes) {
      if (c.day > day) break;
      status = c.status;
    }
    return status;
  };
}

/**
 * 表示期間（from〜to の業務日）の横棒を計算する（FR-R01）。
 * 空白日をまたいでも区間は途切れない（architecture.md 4.5）。完了の後の日は描かない。
 * 表示期間の末日までに完了したタスクは、着手中の区間を完了の区間として返す（完了したタスクの期間）。
 * まだ来ていない日を描かないよう、to には今日より後の日を渡さないこと
 */
export function timelineSegments(
  events: readonly TaskEvent[],
  range: { from: string; to: string },
): TimelineSegment[] {
  const at = statusByDay(events);
  // 完了が続く日は、完了になった日だけを描く
  const drawnOn = (day: string): TimelineStatus | null => {
    const s = at(day);
    if (!isDrawn(s)) return null;
    if (s === 'done' && at(addDays(day, -1)) === 'done') return null;
    return s;
  };

  const length = daysBetween(range.from, range.to) + 1;
  const segments: TimelineSegment[] = [];
  for (let i = 0; i < length; i++) {
    const day = addDays(range.from, i);
    const status = drawnOn(day);
    if (status === null) continue;
    const last = segments.at(-1);
    if (last !== undefined && last.status === status && last.to === addDays(day, -1)) {
      last.to = day;
      continue;
    }
    segments.push({
      status,
      from: day,
      to: day,
      continuesBefore: i === 0 && drawnOn(addDays(day, -1)) === status,
      continuesAfter: false,
    });
  }
  const last = segments.at(-1);
  if (last !== undefined && last.to === range.to) {
    last.continuesAfter = drawnOn(addDays(range.to, 1)) === last.status;
  }
  // 表示期間の末日までに完了したタスクは、着手中の期間を「完了したタスクの期間」として描く（DESIGN.md 4.8 の凡例、
  // Figma「PC/タイムライン」）。中断と待ちは、そのまま描き分ける
  return at(range.to) === 'done' ? asCompletedPeriod(segments) : segments;
}

/** 着手中の区間を完了に置き換え、隣り合った完了の区間を1本にまとめる */
function asCompletedPeriod(segments: readonly TimelineSegment[]): TimelineSegment[] {
  const merged: TimelineSegment[] = [];
  for (const s of segments) {
    const status = s.status === 'doing' ? 'done' : s.status;
    const prev = merged.at(-1);
    if (prev !== undefined && prev.status === status && prev.to === addDays(s.from, -1)) {
      prev.to = s.to;
      prev.continuesAfter = s.continuesAfter;
      continue;
    }
    merged.push({ ...s, status });
  }
  return merged;
}

/**
 * タスクの内訳（FR-R03）。最初に着手した日から today までを暦日で数える（空白日も含む、architecture.md 4.5）。
 * 完了した日は着手中に数え、完了や中止のあとの日は数えない
 */
export function timelineBreakdown(events: readonly TaskEvent[], today: string): TimelineBreakdown {
  const at = statusByDay(events);
  const first = events.find((e) => e.type === 'created' || e.type === 'status_changed');
  const result: TimelineBreakdown = {
    doing: 0,
    paused: 0,
    waiting: 0,
    startedDay: null,
    completedDay: null,
  };
  if (first === undefined) return result;

  const length = daysBetween(first.day, today) + 1;
  for (let i = 0; i < length; i++) {
    const day = addDays(first.day, i);
    const status = at(day);
    if (status === 'doing' || status === 'paused' || status === 'waiting') {
      result.startedDay ??= day;
      result[status]++;
    } else if (status === 'done' && at(addDays(day, -1)) !== 'done') {
      // 同じ日に着手して完了した場合も、着手した日として数える
      result.startedDay ??= day;
      result.doing++;
    }
  }
  if (at(today) === 'done') {
    for (let i = length - 1; i >= 0; i--) {
      const day = addDays(first.day, i);
      if (at(addDays(day, -1)) !== 'done') {
        result.completedDay = day;
        break;
      }
    }
  }
  return result;
}
