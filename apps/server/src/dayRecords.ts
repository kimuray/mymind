import type { DailyLog, DailyLogRepository, TaskRepository } from '@mymind/db';
import { summarizeDay, type TaskEvent } from '@mymind/domain';

/**
 * 日ごとの記録を、カレンダー（FR-R04）と月次総括の入力（FR-A06）で同じ定義で読む。
 * 1回の応答や1回の入力の組み立てごとに作る（タスクのイベントをその中で使い回すため、NFR-18）
 */
export function createDayRecordReader(deps: { tasks: TaskRepository; logs: DailyLogRepository }) {
  const { tasks, logs } = deps;
  const planDays = new Set(tasks.listPlanDays());
  const events = new Map<string, TaskEvent[]>();
  const eventsOf = (taskId: string) => {
    const cached = events.get(taskId);
    if (cached !== undefined) return cached;
    const loaded = tasks.listEvents(taskId);
    events.set(taskId, loaded);
    return loaded;
  };

  return {
    /** その日の完了件数。振り返りの冒頭の「完了」（FR-D07）と同じ定義で数える */
    completedCount: (day: string) =>
      summarizeDay(
        day,
        tasks.listSummaryCandidates(day).map((t) => ({
          taskId: t.id,
          title: t.title,
          events: eventsOf(t.id),
        })),
      ).completed.length,

    /** 空白日：計画も振り返りの記録もない日（architecture.md 4.5） */
    isBlank: (day: string, log: DailyLog | undefined = logs.find(day)) =>
      !planDays.has(day) && log === undefined,
  };
}

/** 振り返りを書いたか。空白だけの振り返りは、書いていないものとして扱う */
export const hasReflection = (log: DailyLog | undefined): log is DailyLog =>
  log !== undefined && (log.thoughtsMd.trim() !== '' || log.learningMd.trim() !== '');
