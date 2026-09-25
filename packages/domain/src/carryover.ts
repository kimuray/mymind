import type { Status } from './status';
import { daysBetween } from './taskDays';
import type { TaskEvent } from './taskEvents';

/**
 * 持ち越しの基準日（FR-D09、architecture.md 4.5）。
 * 「前日」ではなく「今日より前で、計画がある最後の業務日」にする。アプリを開かなかった日（空白日）があっても、
 * 最後に計画した日のタスクが漏れない。計画が一度もなければ null。
 */
export function carryoverBaseDay(plannedDays: readonly string[], today: string): string | null {
  let base: string | null = null;
  for (const day of plannedDays) {
    if (day < today && (base === null || day > base)) base = day;
  }
  return base;
}

/** 基準日と今日のあいだの空白日の数（「3日ぶりの計画です」の表示に使う）。前日が基準日なら 0 */
export function blankDaysSince(baseDay: string, today: string): number {
  return Math.max(0, daysBetween(baseDay, today) - 1);
}

export type PlannedTaskState = { taskId: string; status: Status };

/**
 * 持ち越し候補（FR-D03）：基準日の計画にあって未完了（完了・中止以外）で、今日の計画にまだないタスク。
 * 並び順は基準日の計画の順のまま。
 */
export function carryoverCandidates(
  basePlan: readonly PlannedTaskState[],
  todayPlanTaskIds: readonly string[],
): PlannedTaskState[] {
  const today = new Set(todayPlanTaskIds);
  return basePlan.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled' && !today.has(t.taskId),
  );
}

export type StatusSpan = {
  status: Status;
  /** その状態になった業務日 */
  from: string;
  /** その状態が続いた最後の業務日（今の状態なら until） */
  to: string;
};

/**
 * タスクの状態の区間（タイムラインの横棒、DESIGN.md 4.8）。
 * 状態はイベントのない日（空白日）のあいだも続くので、区間は空白日で途切れない（architecture.md 4.5）。
 * 同じ業務日のうちに変わった状態は、日の単位では残らないので区間にしない（NFR-09）。
 */
export function statusSpans(events: readonly TaskEvent[], until: string): StatusSpan[] {
  const changes: { status: Status; day: string }[] = [];
  for (const e of events) {
    if (e.type === 'created') changes.push({ status: 'todo', day: e.day });
    if (e.type === 'status_changed' || e.type === 'completion_undone') {
      changes.push({ status: e.to, day: e.day });
    }
  }
  const spans: StatusSpan[] = [];
  changes.forEach((change, i) => {
    const next = changes[i + 1];
    if (next !== undefined && next.day === change.day) return;
    const to = next === undefined ? until : previousDay(next.day);
    if (to < change.day) return;
    spans.push({ status: change.status, from: change.day, to });
  });
  return spans;
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new RangeError(`業務日の形式ではありません: ${day}`);
  }
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
