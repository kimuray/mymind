import type { Status, StatusChangeEvent, TaskEvent } from '@mymind/domain';
import { asc, eq } from 'drizzle-orm';
import type { Database } from './client';
import { taskEvents, tasks } from './schema';
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

export type CreateTaskInput = {
  created: Extract<TaskEvent, { type: 'created' }>;
  parentId: string | null;
  title: string;
  noteMd: string | null;
  sortOrder: number;
};

export type ApplyStatusChangeError =
  | { kind: 'not_found'; taskId: string }
  | { kind: 'version_conflict'; taskId: string; currentVersion: number }
  | { kind: 'status_mismatch'; taskId: string; currentStatus: Status };

export type TaskRepositoryDeps = {
  db: Database;
  codec: SensitiveCodec;
  /** イベントの ID（ULID）を作る。テストでは順に増える値を渡す */
  newEventId: () => string;
};

type TaskRow = typeof tasks.$inferSelect;
type EventRow = typeof taskEvents.$inferSelect;

function toEventRow(event: TaskEvent, id: string): typeof taskEvents.$inferInsert {
  const base = { id, taskId: event.taskId, type: event.type, at: event.at, day: event.day };
  return event.type === 'status_changed' || event.type === 'completion_undone'
    ? { ...base, fromStatus: event.from, toStatus: event.to }
    : base;
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
 * タスクとその履歴を保存する（ADR-0004）。
 * ステータスの変更は、イベントの追加と tasks.status の更新を1つのトランザクションで行う。
 * ドライバが同期で動くため、トランザクションの中は同期で書く（ADR-0011）。
 */
export function createTaskRepository({ db, codec, newEventId }: TaskRepositoryDeps) {
  const toTask = (row: TaskRow): Task => ({
    ...row,
    noteMd: row.noteMd === null ? null : codec.decode(row.noteMd),
  });

  return {
    create(input: CreateTaskInput): Task {
      const { created } = input;
      return db.transaction((tx) => {
        const row = tx
          .insert(tasks)
          .values({
            id: created.taskId,
            parentId: input.parentId,
            title: input.title,
            noteMd: input.noteMd === null ? null : codec.encode(input.noteMd),
            status: 'todo',
            sortOrder: input.sortOrder,
            createdAt: created.at,
            lastTouchedAt: created.at,
          })
          .returning()
          .get();
        tx.insert(taskEvents).values(toEventRow(created, newEventId())).run();
        return toTask(row);
      });
    },

    find(id: string): Task | undefined {
      const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
      return row === undefined ? undefined : toTask(row);
    },

    /**
     * domain の changeStatus が作ったイベントを保存し、tasks.status を合わせる。
     * 画面が見ていた version と今の値が違う、または今のステータスがイベントの変更前と違うときは、何も書かずに失敗を返す。
     */
    applyStatusChange(
      event: StatusChangeEvent,
      expectedVersion: number,
    ): { ok: true; value: Task } | { ok: false; error: ApplyStatusChangeError } {
      return db.transaction((tx) => {
        const current = tx.select().from(tasks).where(eq(tasks.id, event.taskId)).get();
        if (current === undefined) {
          return { ok: false, error: { kind: 'not_found', taskId: event.taskId } };
        }
        if (current.version !== expectedVersion) {
          return {
            ok: false,
            error: {
              kind: 'version_conflict',
              taskId: event.taskId,
              currentVersion: current.version,
            },
          };
        }
        if (current.status !== event.from) {
          return {
            ok: false,
            error: {
              kind: 'status_mismatch',
              taskId: event.taskId,
              currentStatus: current.status,
            },
          };
        }
        tx.insert(taskEvents).values(toEventRow(event, newEventId())).run();
        const updated = tx
          .update(tasks)
          .set({ status: event.to, lastTouchedAt: event.at, version: current.version + 1 })
          .where(eq(tasks.id, event.taskId))
          .returning()
          .get();
        return { ok: true, value: toTask(updated) };
      });
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
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
