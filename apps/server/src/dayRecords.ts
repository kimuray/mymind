import type { DailyLog, DailyLogRepository, Task, TaskRepository } from '@mymind/db';
import {
  type BusinessDayOptions,
  blankDaysSince,
  carryoverBaseDay,
  carryoverCandidates,
  isReviewTarget,
  summarizeDay,
  toBusinessDay,
} from '@mymind/domain';

/**
 * 日ごとの記録を、カレンダー（FR-R04）と月次総括の入力（FR-A06）で同じ定義で読む。
 * 1回の応答や1回の入力の組み立てごとに作る（計画のある日の一覧を、その中で使い回すため）
 */
export function createDayRecordReader(deps: { tasks: TaskRepository; logs: DailyLogRepository }) {
  const { tasks, logs } = deps;
  const planDays = new Set(tasks.listPlanDays());

  return {
    /**
     * 日ごとの完了件数。振り返りの冒頭の「完了」（FR-D07）と同じ定義で数える。
     * 候補のタスクの履歴は、日をまたいでまとめて1回で読む（タスクごとに問い合わせないため、NFR-18）
     */
    completedCounts(days: readonly string[]): Map<string, number> {
      const candidates = new Map(days.map((day) => [day, tasks.listSummaryCandidates(day)]));
      const ids = [...new Set([...candidates.values()].flat().map((t) => t.id))];
      const events = tasks.listEventsOfTasks(ids);
      return new Map(
        days.map((day) => [
          day,
          summarizeDay(
            day,
            (candidates.get(day) ?? []).map((t) => ({
              taskId: t.id,
              title: t.title,
              events: events.get(t.id) ?? [],
            })),
          ).completed.length,
        ]),
      );
    },

    /** 空白日：計画も振り返りの記録もない日（architecture.md 4.5） */
    isBlank: (day: string, log: DailyLog | undefined = logs.find(day)) =>
      !planDays.has(day) && log === undefined,
  };
}

export type DayRecordReader = ReturnType<typeof createDayRecordReader>;

/** 振り返りを書いたか。空白だけの振り返りは、書いていないものとして扱う */
export const hasReflection = (log: DailyLog | undefined): log is DailyLog =>
  log !== undefined && (log.thoughtsMd.trim() !== '' || log.learningMd.trim() !== '');

/**
 * 持ち越し候補（FR-D03、FR-D09、architecture.md 4.5）。朝の計画の画面と朝の通知（FR-N01）で同じ定義で数える。
 * 基準日は「今日より前で、計画がある最後の業務日」。その日の計画にあって未完了で、今日の計画にまだないタスク
 */
export function findCarryover(tasks: TaskRepository, day: string) {
  const baseDay = carryoverBaseDay(tasks.listPlanDays(), day);
  if (baseDay === null) return { baseDay, blankDays: 0, candidates: [] };
  const basePlan = tasks.listPlan(baseDay);
  const ids = new Set(
    carryoverCandidates(
      basePlan.map((t) => ({ taskId: t.id, status: t.status })),
      tasks.listPlan(day).map((t) => t.id),
    ).map((t) => t.taskId),
  );
  return {
    baseDay,
    blankDays: blankDaysSince(baseDay, day),
    candidates: basePlan.filter((t) => ids.has(t.id)),
  };
}

/**
 * その日の記録のまとめ（FR-D07）。振り返りの画面と夜の通知（FR-N02）で同じ定義で数える。
 * 候補のタスクの履歴は、タスクごとに問い合わせずにまとめて読む（NFR-18）
 */
export function summarizeDayOf(tasks: TaskRepository, day: string) {
  const candidates = tasks.listSummaryCandidates(day);
  const events = tasks.listEventsOfTasks(candidates.map((t) => t.id));
  return summarizeDay(
    day,
    candidates.map((t) => ({ taskId: t.id, title: t.title, events: events.get(t.id) ?? [] })),
  );
}

/**
 * 棚卸しの対象（FR-R06）：最後に触れてから afterDays 日が経ったバックログのタスクを、触れたのが古い順に返す。
 * 棚卸しの画面と棚卸しの通知（FR-N03）で同じ定義で数える
 */
export function listReviewTargets(
  tasks: TaskRepository,
  today: string,
  afterDays: number,
  dayOptions: BusinessDayOptions,
): Task[] {
  const touchedDay = (t: Task) => toBusinessDay(new Date(t.lastTouchedAt), dayOptions);
  return tasks
    .listBacklog(today)
    .filter((t) => isReviewTarget(touchedDay(t), today, afterDays))
    .sort((a, b) => a.lastTouchedAt.localeCompare(b.lastTouchedAt));
}
