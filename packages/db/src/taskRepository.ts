import type { Status, StatusChangeEvent, TaskEvent } from '@mymind/domain';
import { and, asc, eq, gte, inArray, max, notExists, notInArray } from 'drizzle-orm';
import type { Database } from './client';
import { dayPlans, taskEvents, tasks } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

export type Task = {
  id: string;
  parentId: string | null;
  title: string;
  noteMd: string | null;
  status: Status;
  sortOrder: number;
  createdAt: string;
  lastTouchedAt: string;
  version: number;
};

export type PlannedTask = Task & { position: number };

export type CreateTaskInput = {
  created: Extract<TaskEvent, { type: 'created' }>;
  parentId: string | null;
  title: string;
  noteMd: string | null;
  /** 作成と同時に計画に入れる場合の、計画のイベントと業務日（FR-T01） */
  plan?: { event: Extract<TaskEvent, { type: 'planned' }>; day: string };
};

/** 1つのタスクに対する変更。applyChanges に渡したものは、すべて1つのトランザクションで保存される */
export type TaskChange = {
  taskId: string;
  /** 画面が見ていた version。自動ルールで変わる親のように、画面が操作していないタスクは null */
  expectedVersion: number | null;
  /** domain の関数が作ったイベント。ステータスの変更は、最後の変更後のステータスを tasks.status に写す */
  events: TaskEvent[];
  edit?: { title?: string; noteMd?: string | null };
  plan?: { removeDays: string[]; addDay: string | null };
};

export type ApplyChangesError =
  | { kind: 'not_found'; taskId: string }
  | { kind: 'version_conflict'; taskId: string; currentVersion: number }
  | { kind: 'status_mismatch'; taskId: string; currentStatus: Status };

export type TaskRepositoryDeps = {
  db: Database;
  codec: SensitiveCodec;
  /** イベントの ID（ULID）を作る。同じ時刻でも作った順に大きくなる値にする（履歴の順序に使う） */
  newEventId: () => string;
};

type TaskRow = typeof tasks.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;

/** 途中で失敗したときに、それまでの書き込みを取り消すための例外。トランザクションの外で戻り値に変える */
class AbortChanges extends Error {
  constructor(readonly error: ApplyChangesError) {
    super(error.kind);
  }
}

const isStatusEvent = (e: TaskEvent): e is StatusChangeEvent =>
  e.type === 'status_changed' || e.type === 'completion_undone';

function toEventRow(event: TaskEvent, id: string): typeof taskEvents.$inferInsert {
  const base = { id, taskId: event.taskId, type: event.type, at: event.at, day: event.day };
  return isStatusEvent(event) ? { ...base, fromStatus: event.from, toStatus: event.to } : base;
}

function toEvent(row: EventRow): TaskEvent {
  const base = { taskId: row.taskId, at: row.at, day: row.day };
  switch (row.type) {
    case 'status_changed':
    case 'completion_undone': {
      if (row.fromStatus === null || row.toStatus === null) {
        throw new Error(`task_events ${row.id}: ステータスの変更に変更前後の値がありません`);
      }
      if (row.type === 'completion_undone') {
        if (row.fromStatus !== 'done') {
          throw new Error(`task_events ${row.id}: 完了の取り消しの変更前が完了ではありません`);
        }
        return { ...base, type: row.type, from: row.fromStatus, to: row.toStatus };
      }
      return { ...base, type: row.type, from: row.fromStatus, to: row.toStatus };
    }
    default:
      return { ...base, type: row.type };
  }
}

/**
 * タスクとその履歴、計画を保存する（ADR-0004）。
 * イベントの追加と tasks・day_plans の更新は、1回の操作ごとに1つのトランザクションで行う。
 * ドライバが同期で動くため、トランザクションの中は同期で書く（ADR-0011）。
 */
export function createTaskRepository({ db, codec, newEventId }: TaskRepositoryDeps) {
  const toTask = (row: TaskRow): Task => ({
    ...row,
    noteMd: row.noteMd === null ? null : codec.decode(row.noteMd),
  });
  const encodeNote = (noteMd: string | null) => (noteMd === null ? null : codec.encode(noteMd));

  type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

  const nextPosition = (tx: Tx, day: string) =>
    (tx
      .select({ value: max(dayPlans.position) })
      .from(dayPlans)
      .where(eq(dayPlans.day, day))
      .get()?.value ?? 0) + 1;

  const applyOne = (tx: Tx, change: TaskChange): Task => {
    const current = tx.select().from(tasks).where(eq(tasks.id, change.taskId)).get();
    if (current === undefined) throw new AbortChanges({ kind: 'not_found', taskId: change.taskId });
    if (change.expectedVersion !== null && current.version !== change.expectedVersion) {
      throw new AbortChanges({
        kind: 'version_conflict',
        taskId: change.taskId,
        currentVersion: current.version,
      });
    }

    // ステータスの変更は、今のステータスから順につながっていなければならない
    let status = current.status;
    for (const event of change.events.filter(isStatusEvent)) {
      if (event.from !== status) {
        throw new AbortChanges({
          kind: 'status_mismatch',
          taskId: change.taskId,
          currentStatus: status,
        });
      }
      status = event.to;
    }

    for (const event of change.events) {
      tx.insert(taskEvents).values(toEventRow(event, newEventId())).run();
    }
    if (change.plan) {
      for (const day of change.plan.removeDays) {
        tx.delete(dayPlans)
          .where(and(eq(dayPlans.day, day), eq(dayPlans.taskId, change.taskId)))
          .run();
      }
      if (change.plan.addDay !== null) {
        const day = change.plan.addDay;
        tx.insert(dayPlans)
          .values({ day, taskId: change.taskId, position: nextPosition(tx, day) })
          .run();
      }
    }

    const lastAt =
      change.events
        .map((e) => e.at)
        .sort()
        .at(-1) ?? current.lastTouchedAt;
    const edit = change.edit ?? {};
    return toTask(
      tx
        .update(tasks)
        .set({
          status,
          ...(edit.title === undefined ? {} : { title: edit.title }),
          ...(edit.noteMd === undefined ? {} : { noteMd: encodeNote(edit.noteMd) }),
          lastTouchedAt: lastAt > current.lastTouchedAt ? lastAt : current.lastTouchedAt,
          version: current.version + 1,
        })
        .where(eq(tasks.id, change.taskId))
        .returning()
        .get(),
    );
  };

  const repo = {
    create(input: CreateTaskInput): Task {
      const { created } = input;
      return db.transaction((tx) => {
        const sortOrder =
          (tx
            .select({ value: max(tasks.sortOrder) })
            .from(tasks)
            .get()?.value ?? 0) + 1;
        const row = tx
          .insert(tasks)
          .values({
            id: created.taskId,
            parentId: input.parentId,
            title: input.title,
            noteMd: encodeNote(input.noteMd),
            status: 'todo',
            sortOrder,
            createdAt: created.at,
            lastTouchedAt: created.at,
          })
          .returning()
          .get();
        tx.insert(taskEvents).values(toEventRow(created, newEventId())).run();
        if (input.plan) {
          const { day, event } = input.plan;
          tx.insert(taskEvents).values(toEventRow(event, newEventId())).run();
          tx.insert(dayPlans)
            .values({ day, taskId: created.taskId, position: nextPosition(tx, day) })
            .run();
        }
        return toTask(row);
      });
    },

    /**
     * 1回の操作で起きる変更（画面が操作したタスクと、自動ルールで変わるタスク）をまとめて保存する。
     * どれか1つでも version やステータスが合わなければ、すべてを取り消して失敗を返す（NFR-13）。
     */
    applyChanges(
      changes: TaskChange[],
    ): { ok: true; value: Task[] } | { ok: false; error: ApplyChangesError } {
      try {
        return { ok: true, value: db.transaction((tx) => changes.map((c) => applyOne(tx, c))) };
      } catch (e) {
        if (e instanceof AbortChanges) return { ok: false, error: e.error };
        throw e;
      }
    },

    /** ステータスの変更だけを保存する */
    applyStatusChange(
      event: StatusChangeEvent,
      expectedVersion: number,
    ): { ok: true; value: Task } | { ok: false; error: ApplyChangesError } {
      const result = repo.applyChanges([
        { taskId: event.taskId, expectedVersion, events: [event] },
      ]);
      if (!result.ok) return result;
      const [task] = result.value;
      if (task === undefined) throw new Error('変更したタスクが返されませんでした');
      return { ok: true, value: task };
    },

    find(id: string): Task | undefined {
      const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
      return row === undefined ? undefined : toTask(row);
    },

    listChildren(parentId: string): Task[] {
      return db
        .select()
        .from(tasks)
        .where(eq(tasks.parentId, parentId))
        .orderBy(asc(tasks.sortOrder))
        .all()
        .map(toTask);
    },

    /** タスクが入っている計画の業務日（過去を含む） */
    listPlannedDays(taskId: string): string[] {
      return db
        .select({ day: dayPlans.day })
        .from(dayPlans)
        .where(eq(dayPlans.taskId, taskId))
        .orderBy(asc(dayPlans.day))
        .all()
        .map((r) => r.day);
    },

    /** その業務日の計画を、並び順に返す */
    listPlan(day: string): PlannedTask[] {
      return db
        .select({ task: tasks, position: dayPlans.position })
        .from(dayPlans)
        .innerJoin(tasks, eq(tasks.id, dayPlans.taskId))
        .where(eq(dayPlans.day, day))
        .orderBy(asc(dayPlans.position))
        .all()
        .map(({ task, position }) => ({ ...toTask(task), position }));
    },

    /** バックログ：完了・中止以外で、今日以降のどの計画にも入っていないタスク（architecture.md 5章） */
    listBacklog(today: string): Task[] {
      return db
        .select()
        .from(tasks)
        .where(
          and(
            notInArray(tasks.status, ['done', 'cancelled']),
            notExists(
              db
                .select({ one: dayPlans.taskId })
                .from(dayPlans)
                .where(and(eq(dayPlans.taskId, tasks.id), gte(dayPlans.day, today))),
            ),
          ),
        )
        .orderBy(asc(tasks.sortOrder))
        .all()
        .map(toTask);
    },

    /** タスクの履歴を記録した順に返す（ULID の順） */
    listEvents(taskId: string): TaskEvent[] {
      return db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.id))
        .all()
        .map(toEvent);
    },

    /** 複数のタスクをまとめて取得する（自動ルールで変わった親などを応答に含めるため） */
    findMany(ids: string[]): Task[] {
      if (ids.length === 0) return [];
      return db.select().from(tasks).where(inArray(tasks.id, ids)).all().map(toTask);
    },
  };
  return repo;
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
