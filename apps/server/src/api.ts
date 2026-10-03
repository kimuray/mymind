import { dailyFeedbackSchema } from '@mymind/agent';
import type {
  DailyLogRepository,
  Feedback,
  SettingsRepository,
  Task,
  TaskRepository,
} from '@mymind/db';
import {
  type BusinessDayOptions,
  blankDaysSince,
  CARRYOVER_DECISIONS,
  canBecomeChild,
  canHaveChildren,
  carryoverBaseDay,
  carryoverCandidates,
  changeStatus,
  nextDay,
  planMorning,
  planMove,
  rulesOnMoveToBacklog,
  rulesOnStatusChange,
  STATUSES,
  statusSinceDay,
  summarizeDay,
  toBusinessDay,
} from '@mymind/domain';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import { z } from 'zod';
import { createHealthApi, type HealthDeps } from './health';
import { createJobsApi, type JobsApiDeps } from './jobsApi';
import { createSettingsApi } from './settingsApi';

export type ApiDeps = {
  tasks: TaskRepository;
  /** 現在時刻。テストでは固定の時刻を返す */
  now: () => Date;
  /** 業務日の切り替え（FR-D01）。設定画面ができるまでは起動時の値を使う */
  dayOptions: BusinessDayOptions;
  /** タスクの ID（ULID）を作る */
  newId: () => string;
  /** エージェントのジョブと FB（architecture.md 7章） */
  jobs: JobsApiDeps;
  /** 状態の見える化（NFR-21） */
  health: HealthDeps;
  /** 画面から変えられる設定 */
  settings: SettingsRepository;
  /** 業務日ごとの振り返り（FR-D06） */
  logs: DailyLogRepository;
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
    /** 親の付け替え（FR-T02）。null で親から外す */
    parentId: z.string().min(1).nullable().optional(),
    /** 並べ替え（FR-T10）。plan は画面の業務日の計画の中、backlog はバックログの中での並び順 */
    order: z.strictObject({ in: z.enum(['plan', 'backlog']), value: z.number() }).optional(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.noteMd !== undefined ||
      b.parentId !== undefined ||
      b.order !== undefined,
    { message: 'title、noteMd、parentId、order のどれかを指定してください' },
  );

/** FR-D06、FR-D08：振り返りの本文。一行だけ、片方だけでも保存できる */
const logBody = z.strictObject({ thoughtsMd: z.string(), learningMd: z.string() });

/** FR-D03〜D05：朝の計画の確定。持ち越し候補すべてへの判断と、バックログから今日に入れるタスク */
const planBody = z.strictObject({
  ...screenState,
  decisions: z.array(
    z.strictObject({ taskId: z.string().min(1), decision: z.enum(CARRYOVER_DECISIONS) }),
  ),
  additions: z.array(z.string().min(1)),
});

/** FR-A03：調子の手動の値。0:絶不調 〜 4:絶好調。null で手動の値を外す */
const conditionBody = z.strictObject({ userLevel: z.number().int().min(0).max(4).nullable() });

/**
 * 画面に返す日次 FB。中身はエージェントの出力のスキーマで検証し直してから返す
 * （画面は packages/agent に依存できないため、ここで型の付いた値にする）。読めない FB の中身は null
 */
function toDailyFeedback(f: Feedback | undefined) {
  if (f === undefined) return null;
  const content = dailyFeedbackSchema.safeParse(f.content);
  return {
    id: f.id,
    period: f.period,
    agent: f.agent,
    promptVersion: f.promptVersion,
    createdAt: f.createdAt,
    content: content.success ? content.data : null,
  };
}

const transitionBody = z.strictObject({ ...withVersion, to: z.enum(STATUSES) });

const moveBody = z.strictObject({ ...withVersion, to: z.enum(['today', 'tomorrow', 'backlog']) });

type ErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'DAY_CHANGED'
  | 'INVALID_TRANSITION'
  | 'DEPTH_EXCEEDED'
  | 'PLAN_CONFIRMED';

/** エラーの応答。状態コードを型に残し、Hono RPC のクライアントが成功と失敗を区別できるようにする */
function fail<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  code: ErrorCode,
  message: string,
  extra = {},
) {
  return c.json({ error: { code, message, ...extra } }, status);
}

/**
 * JSON の本文を zod で検証するミドルウェア。形が違えば 400 を返す。
 * 入力の型は Hono RPC で画面と共有される（architecture.md 6章）。
 */
const jsonBody = <T extends z.ZodType>(schema: T) =>
  validator('json', (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return fail(c, 400, 'INVALID_REQUEST', '入力が正しくありません', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data as z.infer<T>;
  });

/**
 * 今日とバックログの API（architecture.md 6章）。
 * 状態の変更はすべて domain の関数でイベントにし、リポジトリが1つのトランザクションで保存する（ADR-0004）。
 */
export function createApi({
  tasks,
  now,
  dayOptions,
  newId,
  jobs,
  health,
  settings,
  logs,
}: ApiDeps) {
  /**
   * 一覧の各行に、画面で必要な値を加える。日数や件数はここで計算し、画面や AI には計算させない。
   * - statusSince：今の状態になった業務日（「着手から何日目」FR-T12）
   * - parentTitle：親の名前（親が同じ一覧にないときにラベルとして出す）
   * - children：子の数と、そのうち完了・中止の数（「子 1/3」）
   */
  const withListInfo = <T extends Task>(list: T[]) => {
    const parentIds = [...new Set(list.flatMap((t) => (t.parentId === null ? [] : [t.parentId])))];
    const parents = new Map(tasks.findMany(parentIds).map((p) => [p.id, p.title]));
    return list.map((t) => {
      const children = tasks.listChildren(t.id);
      return {
        ...t,
        statusSince:
          statusSinceDay(tasks.listEvents(t.id)) ??
          toBusinessDay(new Date(t.createdAt), dayOptions),
        parentTitle: t.parentId === null ? null : (parents.get(t.parentId) ?? null),
        children: {
          total: children.length,
          closed: children.filter((ch) => ch.status === 'done' || ch.status === 'cancelled').length,
        },
      };
    });
  };

  /**
   * 持ち越し候補（FR-D03、FR-D09、architecture.md 4.5）。
   * 基準日は「今日より前で、計画がある最後の業務日」。その日の計画にあって未完了で、今日の計画にまだないタスク
   */
  const findCarryover = (day: string) => {
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
  };

  const previousFeedback = (day: string) => {
    const latest = jobs.jobs.latestDailyFeedbackBefore(day);
    if (latest === undefined) return null;
    return {
      day: latest.period,
      feedback: toDailyFeedback(latest),
      condition: jobs.jobs.findCondition(latest.period) ?? null,
    };
  };

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

  const taskRoutes = new Hono()
    .get('/days/:day', (c) => {
      const day = dayParam.safeParse(c.req.param('day'));
      if (!day.success) return fail(c, 400, 'INVALID_REQUEST', '業務日の形式が正しくありません');
      // FB・調子は、それぞれの画面の issue で加える
      return c.json({
        day: day.data,
        tasks: withListInfo(tasks.listPlan(day.data)),
        log: logs.find(day.data) ?? null,
        // その日の最新の FB（FR-A04）、調子（FR-A03）、最新のジョブ（生成中・失敗の表示、FR-A08）
        feedback: toDailyFeedback(jobs.jobs.listFeedbacks('daily', day.data)[0]),
        condition: jobs.jobs.findCondition(day.data) ?? null,
        job: jobs.jobs.latestJob('daily_feedback', day.data) ?? null,
        // 前日の FB：最後に FB をもらった日のもの（architecture.md 4.5、FR-D02）
        previous: previousFeedback(day.data),
        // 振り返りの冒頭の記録のまとめ（FR-D07）。件数や日数はここで数える
        summary: summarizeDay(
          day.data,
          tasks.listSummaryCandidates(day.data).map((t) => ({
            taskId: t.id,
            title: t.title,
            events: tasks.listEvents(t.id),
          })),
        ),
      });
    })

    .get('/days/:day/carryover', (c) => {
      const day = dayParam.safeParse(c.req.param('day'));
      if (!day.success) return fail(c, 400, 'INVALID_REQUEST', '業務日の形式が正しくありません');
      const confirmedAt = logs.find(day.data)?.planConfirmedAt ?? null;
      const { baseDay, blankDays, candidates } = findCarryover(day.data);
      return c.json({
        day: day.data,
        baseDay,
        blankDays,
        confirmedAt,
        // 確定した後は候補を返さない。バックログへ送ったタスクは基準日の計画に残るので、返すと候補に戻ってしまう
        candidates: confirmedAt === null ? withListInfo(candidates) : [],
      });
    })

    .post('/days/:day/plan', jsonBody(planBody), (c) => {
      const day = dayParam.safeParse(c.req.param('day'));
      const input = c.req.valid('json');
      if (!day.success || day.data !== input.expectedDay) {
        return fail(c, 400, 'INVALID_REQUEST', '業務日の指定が正しくありません');
      }
      const dayError = checkDay(c, input);
      if (dayError) return dayError;
      if ((logs.find(day.data)?.planConfirmedAt ?? null) !== null) {
        return fail(c, 409, 'PLAN_CONFIRMED', 'この日の計画はすでに確定しています');
      }

      // 判断は持ち越し候補のすべてに1つずつ、追加はバックログのタスクだけ
      const candidates = new Map(findCarryover(day.data).candidates.map((t) => [t.id, t]));
      const decided = input.decisions.map((d) => d.taskId);
      const backlog = new Map(tasks.listBacklog(day.data).map((t) => [t.id, t]));
      if (
        new Set(decided).size !== decided.length ||
        decided.length !== candidates.size ||
        decided.some((id) => !candidates.has(id))
      ) {
        return fail(c, 400, 'INVALID_REQUEST', '持ち越し候補のすべてに1つずつ判断してください');
      }
      if (
        new Set(input.additions).size !== input.additions.length ||
        input.additions.some((id) => !backlog.has(id) || candidates.has(id))
      ) {
        return fail(c, 400, 'INVALID_REQUEST', 'バックログにないタスクは追加できません');
      }

      const at = now().toISOString();
      const target = (task: Task) => ({ task, plannedDays: tasks.listPlannedDays(task.id) });
      const plan = planMorning({
        today: day.data,
        at,
        carryovers: input.decisions.flatMap((d) => {
          const task = candidates.get(d.taskId);
          return task === undefined ? [] : [{ ...target(task), decision: d.decision }];
        }),
        additions: input.additions.flatMap((id) => {
          const task = backlog.get(id);
          return task === undefined ? [] : [target(task)];
        }),
      });
      if (!plan.ok) {
        return fail(c, 422, 'INVALID_TRANSITION', 'このタスクは完了にできません', {
          taskId: plan.error.taskId,
        });
      }
      // タスクの変更は1つのトランザクションで保存する。途中で失敗したら何も反映しない（FR-D05）
      const result = tasks.applyChanges(
        plan.value.map((ch) => ({
          taskId: ch.taskId,
          expectedVersion: null,
          events: ch.events,
          ...(ch.plan === null ? {} : { plan: ch.plan }),
        })),
      );
      if (!result.ok) return conflict(c, result.error);
      logs.confirmPlan(day.data, at);
      return c.json({ confirmedAt: at, tasks: withListInfo(tasks.listPlan(day.data)) });
    })

    .put('/days/:day/condition', jsonBody(conditionBody), (c) => {
      const day = dayParam.safeParse(c.req.param('day'));
      if (!day.success) return fail(c, 400, 'INVALID_REQUEST', '業務日の形式が正しくありません');
      if (day.data > toBusinessDay(now(), dayOptions)) {
        return fail(c, 400, 'INVALID_REQUEST', 'まだ来ていない日の調子は付けられません');
      }
      const { userLevel } = c.req.valid('json');
      return c.json({
        condition: jobs.jobs.setUserLevel(day.data, userLevel, now().toISOString()),
      });
    })

    .put('/days/:day/log', jsonBody(logBody), (c) => {
      const day = dayParam.safeParse(c.req.param('day'));
      if (!day.success) return fail(c, 400, 'INVALID_REQUEST', '業務日の形式が正しくありません');
      // 過去の日の振り返りは後から書き足せる（深夜に前日の分を書き終える場合も含む）。まだ来ていない日には書けない
      if (day.data > toBusinessDay(now(), dayOptions)) {
        return fail(c, 400, 'INVALID_REQUEST', 'まだ来ていない日の振り返りは保存できません');
      }
      const input = c.req.valid('json');
      const log = logs.saveReflection({ day: day.data, ...input, at: now().toISOString() });
      return c.json({ log });
    })

    .get('/backlog', (c) => {
      const today = toBusinessDay(now(), dayOptions);
      return c.json({ today, tasks: withListInfo(tasks.listBacklog(today)) });
    })

    .get('/tasks/:id/events', (c) => {
      const taskId = c.req.param('id');
      if (tasks.find(taskId) === undefined) {
        return fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません', { taskId });
      }
      return c.json({ events: tasks.listEvents(taskId) });
    })

    .post('/tasks', jsonBody(createTaskBody), (c) => {
      const input = c.req.valid('json');
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

    .patch('/tasks/:id', jsonBody(editTaskBody), (c) => {
      const input = c.req.valid('json');
      const dayError = checkDay(c, input);
      if (dayError) return dayError;

      const taskId = c.req.param('id');
      if (input.parentId !== undefined && input.parentId !== null) {
        const parent = tasks.find(input.parentId);
        if (parent === undefined) {
          return fail(c, 404, 'NOT_FOUND', '親のタスクが見つかりません', {
            taskId: input.parentId,
          });
        }
        const taskHasChildren = tasks.listChildren(taskId).length > 0;
        if (!canBecomeChild({ taskId, taskHasChildren, parent })) {
          return fail(c, 422, 'DEPTH_EXCEEDED', 'タスクの親子は2階層までです');
        }
      }
      const order = input.order;
      const result = tasks.applyChanges([
        {
          taskId,
          expectedVersion: input.expectedVersion,
          events: [{ type: 'edited', taskId, at: now().toISOString(), day: input.expectedDay }],
          edit: {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.noteMd === undefined ? {} : { noteMd: input.noteMd }),
            ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
            ...(order?.in === 'backlog' ? { sortOrder: order.value } : {}),
          },
          ...(order?.in === 'plan'
            ? {
                plan: {
                  removeDays: [],
                  addDay: null,
                  position: { day: input.expectedDay, value: order.value },
                },
              }
            : {}),
        },
      ]);
      if (!result.ok) return conflict(c, result.error);
      return c.json({ task: result.value[0] });
    })

    .post('/tasks/:id/transition', jsonBody(transitionBody), (c) => {
      const input = c.req.valid('json');
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

    .post('/tasks/:id/move', jsonBody(moveBody), (c) => {
      const input = c.req.valid('json');
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
  return taskRoutes
    .route('/', createJobsApi(jobs))
    .route('/', createHealthApi(health))
    .route('/', createSettingsApi(settings));
}

export type Api = ReturnType<typeof createApi>;
