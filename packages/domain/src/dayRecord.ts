import { type DaySummary, type SummarySource, stateAtEndOfDay, summarizeDay } from './daySummary';
import type { Status } from './status';
import { dayOrdinalSince } from './taskDays';
import type { TaskEvent } from './taskEvents';

/** 記録に入れる、その日の計画のタスク。状態はその日の終わりのもの */
export type DayRecordTask = {
  taskId: string;
  title: string;
  parentTitle: string | null;
  status: Status;
  /** その状態になってから何日目か（その日を1日目と数える、FR-T12） */
  statusDays: number;
  /** タグの名前（FR-A13）。名前の順 */
  tags: string[];
};

export type DayRecordCounts = {
  planned: number;
  done: number;
  doing: number;
  paused: number;
  waiting: number;
};

/**
 * その日の記録（FR-R07、architecture.md 4.6）。イベントから作り、スナップショットとして保存する。
 * FB の入力にはこの記録を使うので、どの入力から FB が作られたかを後から再現できる
 */
export type DayRecord = {
  day: string;
  tasks: DayRecordTask[];
  counts: DayRecordCounts;
  summary: DaySummary;
};

/** 記録の材料。その日の計画のタスクと、そのタスクのすべてのイベント（記録した順） */
export type DayRecordSource = {
  taskId: string;
  title: string;
  parentTitle: string | null;
  tags: readonly string[];
  events: readonly TaskEvent[];
};

/**
 * その日の記録をイベントから作る。件数と日数はここで数え、画面や AI には数えさせない（FR-A10）。
 * 状態はその日の終わりの時点で求めるので、後の日の操作は入らない。
 * planned はその日の計画のタスク（計画の順）、summarySources はまとめの候補（FR-D07 と同じ）
 */
export function buildDayRecord(
  day: string,
  planned: readonly DayRecordSource[],
  summarySources: readonly SummarySource[],
): DayRecord {
  const tasks = planned.flatMap((source): DayRecordTask[] => {
    const state = stateAtEndOfDay(source.events, day);
    // その日の後に作って、後からその日の計画に入れたタスクは、その日にはまだない
    if (state === null) return [];
    return [
      {
        taskId: source.taskId,
        title: source.title,
        parentTitle: source.parentTitle,
        status: state.status,
        statusDays: dayOrdinalSince(state.since, day),
        tags: [...source.tags],
      },
    ];
  });
  const count = (status: Status) => tasks.filter((t) => t.status === status).length;
  return {
    day,
    tasks,
    counts: {
      planned: tasks.length,
      done: count('done'),
      doing: count('doing'),
      paused: count('paused'),
      waiting: count('waiting'),
    },
    summary: summarizeDay(day, summarySources),
  };
}

/** 再生成の前後で違うところ（FR-R07）。画面はこれをそのまま出す */
export type DayRecordDiff = {
  tasks: (
    | { kind: 'added'; taskId: string; title: string; status: Status }
    | { kind: 'removed'; taskId: string; title: string; status: Status }
    | { kind: 'status_changed'; taskId: string; title: string; from: Status; to: Status }
  )[];
  counts: { key: keyof DayRecordCounts; before: number; after: number }[];
  /** まとめの「完了」に加わったタスクと、外れたタスクの名前 */
  completed: { added: string[]; removed: string[] };
};

const COUNT_KEYS = ['planned', 'done', 'doing', 'paused', 'waiting'] as const;

/**
 * 2つの記録を比べて、違うところを返す。名前やタグだけの違いと、日数だけの違いは出さない
 * （記録の不整合を確かめるためのもので、見るのは状態と件数）
 */
export function diffDayRecords(before: DayRecord, after: DayRecord): DayRecordDiff {
  const beforeTasks = new Map(before.tasks.map((t) => [t.taskId, t]));
  const afterIds = new Set(after.tasks.map((t) => t.taskId));
  const tasks: DayRecordDiff['tasks'] = [];
  for (const t of after.tasks) {
    const old = beforeTasks.get(t.taskId);
    if (old === undefined) {
      tasks.push({ kind: 'added', taskId: t.taskId, title: t.title, status: t.status });
    } else if (old.status !== t.status) {
      tasks.push({
        kind: 'status_changed',
        taskId: t.taskId,
        title: t.title,
        from: old.status,
        to: t.status,
      });
    }
  }
  for (const t of before.tasks) {
    if (!afterIds.has(t.taskId)) {
      tasks.push({ kind: 'removed', taskId: t.taskId, title: t.title, status: t.status });
    }
  }
  const completedBefore = new Set(before.summary.completed.map((t) => t.taskId));
  const completedAfter = new Set(after.summary.completed.map((t) => t.taskId));
  return {
    tasks,
    counts: COUNT_KEYS.flatMap((key) =>
      before.counts[key] === after.counts[key]
        ? []
        : [{ key, before: before.counts[key], after: after.counts[key] }],
    ),
    completed: {
      added: after.summary.completed
        .filter((t) => !completedBefore.has(t.taskId))
        .map((t) => t.title),
      removed: before.summary.completed
        .filter((t) => !completedAfter.has(t.taskId))
        .map((t) => t.title),
    },
  };
}

/** 違いが1つもないか */
export function isEmptyDayRecordDiff(diff: DayRecordDiff): boolean {
  return (
    diff.tasks.length === 0 &&
    diff.counts.length === 0 &&
    diff.completed.added.length === 0 &&
    diff.completed.removed.length === 0
  );
}
