import type { Status } from './status';
import { dayOrdinalSince } from './taskDays';
import type { TaskEvent } from './taskEvents';

/** 待ちが何日続いたら「待ちが継続」として出すか（#93 の決定） */
export const LONG_WAITING_DAYS = 3;

/** まとめの材料。タスクの名前と、そのタスクのすべてのイベント（記録した順） */
export type SummarySource = { taskId: string; title: string; events: readonly TaskEvent[] };

type Named = { taskId: string; title: string };

/**
 * 振り返りの冒頭に出す、その日の記録のまとめ（FR-D07、#93 の決定 A）。
 * - completed：その日に完了にし、その日の終わりにも完了のタスク
 * - started：その日の終わりに着手中のタスク。その日に着手したものは isNew、前からのものは何日目か
 * - changes：その日の完了・着手以外の状態変化（その日の始めと終わりの状態）と、待ちが3日以上続いているタスク
 */
export type DaySummary = {
  completed: Named[];
  started: (Named & { isNew: boolean; dayOrdinal: number })[];
  changes: (
    | (Named & { kind: 'changed'; from: Status; to: Status })
    | (Named & { kind: 'waiting_continues'; dayOrdinal: number })
  )[];
};

const isStatusEvent = (e: TaskEvent) =>
  e.type === 'status_changed' || e.type === 'completion_undone';

/**
 * ある時点までのイベントから、状態と、その状態になった業務日を求める。
 * 作成のイベントは未着手として数える。その時点でまだないタスクは null
 */
function stateAt(events: readonly TaskEvent[], isIncluded: (e: TaskEvent) => boolean) {
  let state: { status: Status; since: string } | null = null;
  for (const e of events) {
    if (!isIncluded(e)) continue;
    if (e.type === 'created') state = { status: 'todo', since: e.day };
    else if (e.type === 'status_changed' || e.type === 'completion_undone') {
      state = { status: e.to, since: e.day };
    }
  }
  return state;
}

/** その日の記録のまとめを作る。件数や日数はここで数え、画面や AI には数えさせない */
export function summarizeDay(day: string, sources: readonly SummarySource[]): DaySummary {
  const summary: DaySummary = { completed: [], started: [], changes: [] };
  for (const { taskId, title, events } of sources) {
    const end = stateAt(events, (e) => e.day <= day);
    if (end === null) continue;
    // その日に作ったタスクは、未着手から始まったものとして比べる
    const start = stateAt(events, (e) => e.day < day)?.status ?? 'todo';
    const changedToday = events.some((e) => e.day === day && isStatusEvent(e));

    if (end.status === 'done' && changedToday) {
      summary.completed.push({ taskId, title });
    } else if (end.status === 'doing') {
      summary.started.push({
        taskId,
        title,
        isNew: end.since === day,
        dayOrdinal: dayOrdinalSince(end.since, day),
      });
    } else if (changedToday && start !== end.status) {
      summary.changes.push({ kind: 'changed', taskId, title, from: start, to: end.status });
    } else if (end.status === 'waiting' && end.since < day) {
      const dayOrdinal = dayOrdinalSince(end.since, day);
      if (dayOrdinal >= LONG_WAITING_DAYS) {
        summary.changes.push({ kind: 'waiting_continues', taskId, title, dayOrdinal });
      }
    }
  }
  return summary;
}
