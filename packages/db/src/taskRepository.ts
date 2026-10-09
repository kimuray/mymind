import type { Status, StatusChangeEvent, TaskEvent } from '@mymind/domain';
import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  lt,
  max,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { Database } from './client';
import { dayPlans, taskEvents, tasks, taskTags } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

/** タスク名の検索で返す最大の件数（FR-M02） */
export const SEARCH_LIMIT = 50;

/** LIKE の特別な文字（%、_、\）を、文字そのものとして探すための形にする */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** ステータスが変わるイベントの種類 */
const STATUS_EVENT_TYPES = ['status_changed', 'completion_undone'] as const;

/** まとめて履歴を読むときに、1回の問い合わせに入れるタスクの数 */
const EVENT_BATCH_SIZE = 500;

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
  /** 編集。parentId は親の付け替え（FR-T02）、sortOrder はバックログでの並び順（FR-T10） */
  edit?: { title?: string; noteMd?: string | null; parentId?: string | null; sortOrder?: number };
  /** 計画の出し入れ。position は、その業務日の計画の中での並び順の変更（FR-T10） */
  plan?: {
    removeDays: string[];
    addDay: string | null;
    position?: { day: string; value: number };
  };
  /**
   * イベントを残さずに、最後に触れた日時だけを進める（棚卸しの「残す」、FR-R06）。
   * 状態は変えないので、ステータスの変更のイベントは要らない
   */
  touchedAt?: string;
  /**
   * タグの付け外し（FR-T13）。タスクの属性の変更として版を進めるが、イベントには残さず、最後に触れた日時も変えない
   * （requirements.md 5章）。付いているタグを付けても、付いていないタグを外しても何もしない
   */
  tags?: { attach?: string[]; detach?: string[] };
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
      if (change.plan.position !== undefined) {
        const { day, value } = change.plan.position;
        tx.update(dayPlans)
          .set({ position: value })
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

    for (const tagId of change.tags?.attach ?? []) {
      tx.insert(taskTags).values({ taskId: change.taskId, tagId }).onConflictDoNothing().run();
    }
    for (const tagId of change.tags?.detach ?? []) {
      tx.delete(taskTags)
        .where(and(eq(taskTags.taskId, change.taskId), eq(taskTags.tagId, tagId)))
        .run();
    }

    const lastAt =
      [
        ...change.events.map((e) => e.at),
        ...(change.touchedAt === undefined ? [] : [change.touchedAt]),
      ]
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
          ...(edit.parentId === undefined ? {} : { parentId: edit.parentId }),
          ...(edit.sortOrder === undefined ? {} : { sortOrder: edit.sortOrder }),
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

    /** 計画に行がある業務日（持ち越しの基準日を求めるため、architecture.md 4.5） */
    listPlanDays(): string[] {
      return db
        .selectDistinct({ day: dayPlans.day })
        .from(dayPlans)
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

    /** 複数の親の子を、親ごとにまとめて返す（一覧の「子 1/3」を、親ごとに問い合わせずに数えるため、NFR-18） */
    listChildrenOfMany(parentIds: readonly string[]): Map<string, Task[]> {
      const result = new Map<string, Task[]>(parentIds.map((id) => [id, []]));
      for (let i = 0; i < parentIds.length; i += EVENT_BATCH_SIZE) {
        const rows = db
          .select()
          .from(tasks)
          .where(inArray(tasks.parentId, parentIds.slice(i, i + EVENT_BATCH_SIZE)))
          .orderBy(asc(tasks.sortOrder))
          .all();
        for (const row of rows) {
          if (row.parentId !== null) result.get(row.parentId)?.push(toTask(row));
        }
      }
      return result;
    },

    /**
     * 複数のタスクの履歴を、タスクごとに記録した順でまとめて返す（月の集計で、タスクごとに問い合わせないため、NFR-18）。
     * SQLite の変数の数の上限に当たらないよう、決まった件数ずつに分けて読む
     */
    listEventsOfTasks(taskIds: readonly string[]): Map<string, TaskEvent[]> {
      const result = new Map<string, TaskEvent[]>(taskIds.map((id) => [id, []]));
      for (let i = 0; i < taskIds.length; i += EVENT_BATCH_SIZE) {
        const rows = db
          .select()
          .from(taskEvents)
          .where(inArray(taskEvents.taskId, taskIds.slice(i, i + EVENT_BATCH_SIZE)))
          .orderBy(asc(taskEvents.id))
          .all();
        for (const row of rows) result.get(row.taskId)?.push(toEvent(row));
      }
      return result;
    },

    /**
     * その日の記録のまとめ（FR-D07）の候補：その日にイベントがあるか、その日の計画にあるか、
     * 今も着手中か待ちのタスク（前から続いている着手と待ちを拾うため）
     */
    listSummaryCandidates(day: string): Task[] {
      return db
        .select()
        .from(tasks)
        .where(
          or(
            inArray(
              tasks.id,
              db.select({ id: taskEvents.taskId }).from(taskEvents).where(eq(taskEvents.day, day)),
            ),
            inArray(
              tasks.id,
              db.select({ id: dayPlans.taskId }).from(dayPlans).where(eq(dayPlans.day, day)),
            ),
            inArray(tasks.status, ['doing', 'waiting']),
          ),
        )
        .orderBy(asc(tasks.sortOrder))
        .all()
        .map(toTask);
    },

    /**
     * タイムライン（FR-R01）に横棒を描くタスク：期間の中で状態が変わったタスクと、
     * 期間の初日の前から着手中・中断・待ちが続いているタスク（期間の中にイベントがなくても描くため）
     */
    listTimelineTasks(from: string, to: string): Task[] {
      const changedInRange = db
        .selectDistinct({ id: taskEvents.taskId })
        .from(taskEvents)
        .where(and(between(taskEvents.day, from, to), inArray(taskEvents.type, STATUS_EVENT_TYPES)))
        .all()
        .map((r) => r.id);
      // 期間の初日より前の、タスクごとの最後のステータスの変更
      const lastBefore = db
        .select({ lastId: max(taskEvents.id).as('last_id') })
        .from(taskEvents)
        .where(and(lt(taskEvents.day, from), inArray(taskEvents.type, STATUS_EVENT_TYPES)))
        .groupBy(taskEvents.taskId)
        .as('last_before');
      const continuing = db
        .select({ id: taskEvents.taskId })
        .from(taskEvents)
        .innerJoin(lastBefore, eq(taskEvents.id, lastBefore.lastId))
        .where(inArray(taskEvents.toStatus, ['doing', 'paused', 'waiting']))
        .all()
        .map((r) => r.id);
      const ids = [...new Set([...changedInRange, ...continuing])];
      if (ids.length === 0) return [];
      return db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, ids))
        .orderBy(asc(tasks.sortOrder))
        .all()
        .map(toTask);
    },

    /**
     * タスク名の部分一致で探す（FR-M02 の search_tasks）。新しく作った順に、最大 SEARCH_LIMIT 件。
     * 振り返りやメモの本文は探さない（全文検索は対象外、requirements.md 6章）
     */
    searchByTitle(query: string): Task[] {
      return db
        .select()
        .from(tasks)
        .where(sql`${tasks.title} LIKE ${`%${escapeLike(query)}%`} ESCAPE '\\'`)
        .orderBy(desc(tasks.createdAt))
        .limit(SEARCH_LIMIT)
        .all()
        .map(toTask);
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
