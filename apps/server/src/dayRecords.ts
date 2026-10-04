import type { DailyLog, DailyLogRepository, TaskRepository } from '@mymind/db';
import { summarizeDay } from '@mymind/domain';

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
