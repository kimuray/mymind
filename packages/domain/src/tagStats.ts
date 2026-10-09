import { daysBetween } from './taskDays';
import type { TaskEvent } from './taskEvents';
import { statusByDay } from './timeline';

/** 集計の材料。タスクに今付いているタグと、そのタスクのすべてのイベント（記録した順） */
export type TagStatsSource = { tagIds: readonly string[]; events: readonly TaskEvent[] };

/**
 * タグごとの集計（FR-R08）。tagId が null の行は「タグなし」。
 * - completed：期間の中で完了にしたタスクの数（振り返りの「完了」と同じく、その日に完了にし、その日の終わりにも完了のもの。日ごとに数えて足す）
 * - doingDays / waitingDays：期間の中で、その日の終わりに着手中・待ちだった日数をタスクごとに数えて足したもの。
 *   完了した日は着手中に数える（タイムラインの内訳 FR-R03 と同じ）
 */
export type TagStat = {
  tagId: string | null;
  completed: number;
  doingDays: number;
  waitingDays: number;
};

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const isStatusEvent = (e: TaskEvent) =>
  e.type === 'status_changed' || e.type === 'completion_undone';

/** 1つのタスクの、期間の中の完了の数と、着手中・待ちの日数 */
function countTask(events: readonly TaskEvent[], range: { from: string; to: string }) {
  const at = statusByDay(events);
  const changedOn = new Set(events.filter(isStatusEvent).map((e) => e.day));
  const result = { completed: 0, doingDays: 0, waitingDays: 0 };
  const length = daysBetween(range.from, range.to) + 1;
  for (let i = 0; i < length; i++) {
    const day = addDays(range.from, i);
    const status = at(day);
    const completedToday = status === 'done' && changedOn.has(day);
    if (completedToday) result.completed++;
    if (status === 'doing' || completedToday) result.doingDays++;
    if (status === 'waiting') result.waitingDays++;
  }
  return result;
}

/**
 * 期間（from〜to の業務日、両端を含む）のタグごとの集計（FR-R08）。集計は今付いているタグで数える（requirements.md 5章）。
 * 複数のタグが付いたタスクは、それぞれのタグに数える。タグのないタスクは「タグなし」（tagId が null）にまとめる。
 * 行は tagOrder の順（名前の順を渡す）で、「タグなし」は最後。どれも 0 の行は返さない。
 * まだ来ていない日を数えないよう、to には今日より後の日を渡さないこと
 */
export function tagStats(
  sources: readonly TagStatsSource[],
  range: { from: string; to: string },
  tagOrder: readonly string[],
): TagStat[] {
  if (range.from > range.to) return [];
  const byTag = new Map<string | null, TagStat>();
  for (const { tagIds, events } of sources) {
    const counts = countTask(events, range);
    for (const tagId of tagIds.length === 0 ? [null] : tagIds) {
      const stat = byTag.get(tagId) ?? { tagId, completed: 0, doingDays: 0, waitingDays: 0 };
      stat.completed += counts.completed;
      stat.doingDays += counts.doingDays;
      stat.waitingDays += counts.waitingDays;
      byTag.set(tagId, stat);
    }
  }
  const isEmpty = (s: TagStat) => s.completed === 0 && s.doingDays === 0 && s.waitingDays === 0;
  return [...tagOrder, null]
    .map((id) => byTag.get(id))
    .filter((s): s is TagStat => s !== undefined && !isEmpty(s));
}
