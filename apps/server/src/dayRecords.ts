import type {
  DailyLog,
  DailyLogRepository,
  DailyRecordRepository,
  DailyRecordSource,
  TagRepository,
  Task,
  TaskRepository,
} from '@mymind/db';
import {
  type BusinessDayOptions,
  blankDaysSince,
  buildDayRecord,
  carryoverBaseDay,
  carryoverCandidates,
  type DayRecord,
  type DayRecordDiff,
  diffDayRecords,
  isEmptyDayRecordDiff,
  isReviewTarget,
  STATUSES,
  summarizeDay,
  toBusinessDay,
} from '@mymind/domain';
import { z } from 'zod';

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

const named = { taskId: z.string(), title: z.string() };
const count = z.number().int().min(0);

/**
 * 保存した記録の形（domain の DayRecord）。DB から読んだ中身は、使う前にこのスキーマで確かめる。
 * 形が合わない記録（壊れた中身、古い形）は「ない」ものとして扱い、イベントから作り直す
 */
const dayRecordSchema: z.ZodType<DayRecord> = z.object({
  day: z.string(),
  tasks: z.array(
    z.object({
      ...named,
      parentTitle: z.string().nullable(),
      status: z.enum(STATUSES),
      statusDays: z.number().int().min(1),
      tags: z.array(z.string()),
    }),
  ),
  counts: z.object({ planned: count, done: count, doing: count, paused: count, waiting: count }),
  summary: z.object({
    completed: z.array(z.object(named)),
    started: z.array(z.object({ ...named, isNew: z.boolean(), dayOrdinal: z.number().int() })),
    changes: z.array(
      z.discriminatedUnion('kind', [
        z.object({
          ...named,
          kind: z.literal('changed'),
          from: z.enum(STATUSES),
          to: z.enum(STATUSES),
        }),
        z.object({
          ...named,
          kind: z.literal('waiting_continues'),
          dayOrdinal: z.number().int(),
        }),
      ]),
    ),
  }),
});

export type RegenerateResult = {
  /** 作り直す前のスナップショット。なかった、または読めなかったときは null */
  before: DayRecord | null;
  after: DayRecord;
  /** 前後の違い。前のスナップショットがなければ null（比べるものがない） */
  diff: DayRecordDiff | null;
  changed: boolean;
};

/**
 * 日ごとの記録のスナップショット（FR-R07、architecture.md 4.6）。
 * 振り返りの保存と FB の依頼で取り、FB の入力に使う。「記録を再生成」はイベントから作り直して上書きする
 */
export function createDayRecordStore(deps: {
  tasks: TaskRepository;
  tags: TagRepository;
  records: DailyRecordRepository;
}) {
  const { tasks, tags, records } = deps;

  /** その日の記録を、今のイベントから作る。履歴はタスクごとに問い合わせずにまとめて読む（NFR-18） */
  const build = (day: string): DayRecord => {
    const plan = tasks.listPlan(day);
    const candidates = tasks.listSummaryCandidates(day);
    const events = tasks.listEventsOfTasks([...plan, ...candidates].map((t) => t.id));
    const parentIds = [...new Set(plan.flatMap((t) => (t.parentId === null ? [] : [t.parentId])))];
    const parents = new Map(tasks.findMany(parentIds).map((p) => [p.id, p.title]));
    const tagsOf = tags.tagsOfTasks(plan.map((t) => t.id));
    return buildDayRecord(
      day,
      plan.map((t) => ({
        taskId: t.id,
        title: t.title,
        parentTitle: t.parentId === null ? null : (parents.get(t.parentId) ?? null),
        // タグは名前だけを持つ。メモ（noteMd）は持たない（FR-A13）
        tags: (tagsOf.get(t.id) ?? []).map((g) => g.name),
        events: events.get(t.id) ?? [],
      })),
      candidates.map((t) => ({ taskId: t.id, title: t.title, events: events.get(t.id) ?? [] })),
    );
  };

  /** 保存してあるスナップショット。ない、または形が合わなければ null */
  const read = (day: string): DayRecord | null => {
    const parsed = dayRecordSchema.safeParse(records.find(day)?.record);
    return parsed.success ? parsed.data : null;
  };

  const snapshot = (day: string, source: DailyRecordSource, at: string): DayRecord => {
    const record = build(day);
    records.save({ day, record, source, at });
    return record;
  };

  return {
    build,
    read,
    /** 今のイベントから作って保存する（同じ日は上書き） */
    snapshot,
    /** イベントから作り直して上書きし、前後の違いを返す（FR-R07） */
    regenerate(day: string, at: string): RegenerateResult {
      const before = read(day);
      const after = snapshot(day, 'regenerated', at);
      const diff = before === null ? null : diffDayRecords(before, after);
      return { before, after, diff, changed: diff !== null && !isEmptyDayRecordDiff(diff) };
    },
  };
}

export type DayRecordStore = ReturnType<typeof createDayRecordStore>;
