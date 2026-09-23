import type { TaskRepository } from '@mymind/db';
import {
  type BusinessDayOptions,
  canHaveChildren,
  changeStatus,
  nextDay,
  planMove,
  rulesOnMoveToBacklog,
  rulesOnStatusChange,
  STATUSES,
  toBusinessDay,
} from '@mymind/domain';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

export type ApiDeps = {
  tasks: TaskRepository;
  /** 現在時刻。テストでは固定の時刻を返す */
  now: () => Date;
  /** 業務日の切り替え（FR-D01）。設定画面ができるまでは起動時の値を使う */
  dayOptions: BusinessDayOptions;
  /** タスクの ID（ULID）を作る */
  newId: () => string;
};

const dayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形式で指定してください');

/** 更新系の API に共通する、画面が想定している状態（NFR-13、NFR-14） */
const screenState = {
  /** 画面が表示している業務日。現在の業務日と違えば、allowPastDay がない限り拒否する */
  expectedDay: dayParam,
  allowPastDay: z.boolean().optional(),
};
const withVersion = { ...screenState, expectedVersion: z.number().int().positive() };

const createTaskBody = z.strictObject({
  ...screenState,
  title: z.string().trim().min(1, 'タイトルを入力してください'),
  parentId: z.string().min(1).nullable().optional(),
  noteMd: z.string().nullable().optional(),
  /** FR-T01：追加した画面が今日なら今日の計画に入れる。指定がなければバックログに入る */
  planFor: z.enum(['today', 'tomorrow']).optional(),
});

const editTaskBody = z
  .strictObject({
    ...withVersion,
    title: z.string().trim().min(1, 'タイトルを入力してください').optional(),
    noteMd: z.string().nullable().optional(),
  })
  .refine((b) => b.title !== undefined || b.noteMd !== undefined, {
    message: 'title か noteMd のどちらかを指定してください',
  });

const transitionBody = z.strictObject({ ...withVersion, to: z.enum(STATUSES) });

const moveBody = z.strictObject({ ...withVersion, to: z.enum(['today', 'tomorrow', 'backlog']) });

type ErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'DAY_CHANGED'
  | 'INVALID_TRANSITION'
  | 'DEPTH_EXCEEDED';

function fail(
  c: Context,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  extra = {},
) {
  return c.json({ error: { code, message, ...extra } }, status);
}

/** JSON の本文を読んで検証する。読めない・形が違う場合は 400 の応答を返す */
async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; value: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: fail(c, 400, 'INVALID_REQUEST', '本文が JSON ではありません') };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(c, 400, 'INVALID_REQUEST', '入力が正しくありません', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }),
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * 今日とバックログの API（architecture.md 6章）。
 * 状態の変更はすべて domain の関数でイベントにし、リポジトリが1つのトランザクションで保存する（ADR-0004）。
 */
export function createApi({ tasks, now, dayOptions, newId }: ApiDeps) {
  /** 画面が想定する業務日と、現在の業務日を比べる（NFR-14） */
  const checkDay = (
    c: Context,
    body: { expectedDay: string; allowPastDay?: boolean | undefined },
  ) => {
    const current = toBusinessDay(now(), dayOptions);
    if (body.expectedDay !== current && body.allowPastDay !== true) {
      return fail(c, 409, 'DAY_CHANGED', '業務日が変わりました。今日の画面を開き直してください', {
        currentDay: current,
      });
    }
    return null;
  };

  const conflict = (
    c: Context,
    error: { kind: 'not_found' | 'version_conflict' | 'status_mismatch'; taskId: string },
  ) =>
    error.kind === 'not_found'
      ? fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません', { taskId: error.taskId })
      : fail(c, 409, 'VERSION_CONFLICT', '別の画面で変更されています。読み直してください', {
          taskId: error.taskId,
        });

  return new Hono()
    .get('/days/:day', (c) => {
      const day = dayParam.safeParse(c.req.param('day'));
      if (!day.success) return fail(c, 400, 'INVALID_REQUEST', '業務日の形式が正しくありません');
      // ログ・FB・調子は、それぞれのテーブルを作る issue で加える
      return c.json({ day: day.data, tasks: tasks.listPlan(day.data) });
    })

    .get('/backlog', (c) => {
      const today = toBusinessDay(now(), dayOptions);
      return c.json({ today, tasks: tasks.listBacklog(today) });
    })

    .post('/tasks', async (c) => {
      const body = await parseBody(c, createTaskBody);
      if (!body.ok) return body.response;
      const input = body.value;
      const dayError = checkDay(c, input);
      if (dayError) return dayError;

      const parentId = input.parentId ?? null;
      if (parentId !== null) {
        const parent = tasks.find(parentId);
        if (parent === undefined) {
          return fail(c, 404, 'NOT_FOUND', '親のタスクが見つかりません', { taskId: parentId });
        }
        if (!canHaveChildren(parent)) {
          return fail(c, 422, 'DEPTH_EXCEEDED', 'タスクの親子は2階層までです');
        }
      }

      const at = now().toISOString();
      const day = input.expectedDay;
      const taskId = newId();
      const planDay =
        input.planFor === undefined ? null : input.planFor === 'today' ? day : nextDay(day);
      const task = tasks.create({
        created: { type: 'created', taskId, at, day },
        parentId,
        title: input.title,
        noteMd: input.noteMd ?? null,
        ...(planDay === null
          ? {}
          : { plan: { day: planDay, event: { type: 'planned', taskId, at, day } } }),
      });
      return c.json({ task }, 201);
    })

    .patch('/tasks/:id', async (c) => {
      const body = await parseBody(c, editTaskBody);
      if (!body.ok) return body.response;
      const input = body.value;
      const dayError = checkDay(c, input);
      if (dayError) return dayError;

      const taskId = c.req.param('id');
      const result = tasks.applyChanges([
        {
          taskId,
          expectedVersion: input.expectedVersion,
          events: [{ type: 'edited', taskId, at: now().toISOString(), day: input.expectedDay }],
          edit: {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.noteMd === undefined ? {} : { noteMd: input.noteMd }),
          },
        },
      ]);
      if (!result.ok) return conflict(c, result.error);
      return c.json({ task: result.value[0] });
    })

    .post('/tasks/:id/transition', async (c) => {
      const body = await parseBody(c, transitionBody);
      if (!body.ok) return body.response;
      const input = body.value;
      const dayError = checkDay(c, input);
      if (dayError) return dayError;

      const taskId = c.req.param('id');
      const task = tasks.find(taskId);
      if (task === undefined)
        return fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません', { taskId });
      const ctx = { at: now().toISOString(), day: input.expectedDay };
      const change = changeStatus({ taskId, from: task.status, to: input.to, ...ctx });
      if (!change.ok) {
        return fail(c, 422, 'INVALID_TRANSITION', 'このステータスには変えられません', {
          from: change.error.from,
          to: change.error.to,
        });
      }

      const parent = task.parentId === null ? undefined : tasks.find(task.parentId);
      const outcome = rulesOnStatusChange(
        {
          task: { ...task, status: input.to },
          parent: parent ?? null,
          siblings:
            parent === undefined
              ? []
              : tasks.listChildren(parent.id).filter((t) => t.id !== taskId),
        },
        ctx,
      );
      const result = tasks.applyChanges([
        { taskId, expectedVersion: input.expectedVersion, events: [change.value] },
        // 自動ルールで変わるタスクは画面が操作したものではないので、version は確かめない
        ...outcome.events.map((e) => ({ taskId: e.taskId, expectedVersion: null, events: [e] })),
      ]);
      if (!result.ok) return conflict(c, result.error);
      const [updated, ...affected] = result.value;
      return c.json({ task: updated, affected, suggestions: outcome.suggestions });
    })

    .post('/tasks/:id/move', async (c) => {
      const body = await parseBody(c, moveBody);
      if (!body.ok) return body.response;
      const input = body.value;
      const dayError = checkDay(c, input);
      if (dayError) return dayError;

      const taskId = c.req.param('id');
      const task = tasks.find(taskId);
      if (task === undefined)
        return fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません', { taskId });
      const ctx = { at: now().toISOString(), day: input.expectedDay };
      const plan = planMove({
        taskId,
        plannedDays: tasks.listPlannedDays(taskId),
        today: input.expectedDay,
        target: input.to,
        at: ctx.at,
      });
      const outcome =
        input.to === 'backlog' ? rulesOnMoveToBacklog(task, ctx) : { events: [], suggestions: [] };
      const events = [...plan.events, ...outcome.events];
      if (events.length === 0) return c.json({ task, suggestions: [] });

      const result = tasks.applyChanges([
        {
          taskId,
          expectedVersion: input.expectedVersion,
          events,
          plan: { removeDays: plan.removeDays, addDay: plan.addDay },
        },
      ]);
      if (!result.ok) return conflict(c, result.error);
      return c.json({ task: result.value[0], suggestions: outcome.suggestions });
    });
}

export type Api = ReturnType<typeof createApi>;
