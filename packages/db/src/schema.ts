// アプリのスキーマ（docs/architecture.md 5章）。変更したら pnpm --filter @mymind/db db:generate でマイグレーションを作る。
import { JOB_KINDS, JOB_STATUSES, STATUSES } from '@mymind/domain';
import {
  type AnySQLiteColumn,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

const EVENT_TYPES = [
  'created',
  'status_changed',
  'planned',
  'unplanned',
  'edited',
  'completion_undone',
] as const;

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), // ULID
  // 親子は2階層まで（FR-T02）。深さの判定は domain で行う
  parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id),
  title: text('title').notNull(),
  // 機微データ。読み書きは必ず SensitiveCodec を通す（ADR-0009）
  noteMd: text('note_md'),
  // task_events の写し。イベントと同じトランザクションでだけ更新する（ADR-0004）
  status: text('status', { enum: STATUSES }).notNull(),
  sortOrder: real('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  lastTouchedAt: text('last_touched_at').notNull(),
  // 古い画面からの更新を検出する（NFR-13）
  version: integer('version').notNull().default(1),
});

export const dayPlans = sqliteTable(
  'day_plans',
  {
    day: text('day').notNull(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    position: real('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.taskId] })],
);

export const taskEvents = sqliteTable('task_events', {
  id: text('id').primaryKey(), // ULID。同じ時刻のイベントの順序も ID の順で決まる
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  type: text('type', { enum: EVENT_TYPES }).notNull(),
  fromStatus: text('from_status', { enum: STATUSES }),
  toStatus: text('to_status', { enum: STATUSES }),
  at: text('at').notNull(), // UTC
  day: text('day').notNull(), // 業務日
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const agentJobs = sqliteTable('agent_jobs', {
  id: text('id').primaryKey(), // ULID
  kind: text('kind', { enum: JOB_KINDS }).notNull(),
  period: text('period').notNull(), // 2026-09-22 / 2026-09
  agent: text('agent').notNull(), // claude / codex / fake
  status: text('status', { enum: JOB_STATUSES }).notNull(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
});

export const feedbacks = sqliteTable('feedbacks', {
  id: text('id').primaryKey(), // ULID
  scope: text('scope', { enum: ['daily', 'monthly'] }).notNull(),
  period: text('period').notNull(),
  jobId: text('job_id').references(() => agentJobs.id),
  // 機微データ。読み書きは必ず SensitiveCodec を通す（ADR-0009）
  contentJson: text('content_json').notNull(),
  agent: text('agent').notNull(),
  promptVersion: text('prompt_version').notNull(),
  isPartial: integer('is_partial', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const conditions = sqliteTable('conditions', {
  day: text('day').primaryKey(),
  aiLevel: integer('ai_level'), // 0:絶不調 〜 4:絶好調
  // 機微データ。読み書きは必ず SensitiveCodec を通す（ADR-0009）
  aiReason: text('ai_reason'),
  userLevel: integer('user_level'),
  updatedAt: text('updated_at').notNull(),
});
