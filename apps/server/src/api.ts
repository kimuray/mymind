import { dailyFeedbackSchema, monthlySummarySchema } from '@mymind/agent';
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
  daysBetween,
  daysOfMonth,
  daysSinceTouched,
  isReviewTarget,
  nextDay,
  planMorning,
  planMove,
  planReviewDecision,
  REVIEW_DECISIONS,
  rulesOnMoveToBacklog,
  rulesOnStatusChange,
  STATUSES,
  type Status,
  statusSinceDay,
  summarizeDay,
  timelineBreakdown,
  timelineSegments,
  toBusinessDay,
} from '@mymind/domain';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import { z } from 'zod';
import { createDayRecordReader, type DayRecordReader, hasReflection } from './dayRecords';
import { createHealthApi, type HealthDeps } from './health';
import { createJobsApi, type JobsApiDeps } from './jobsApi';
import { calendarDayParam, monthParam } from './params';
import {
  type AppSettings,
  createSettingsApi,
  createSettingsReader,
  type SettingsRuntime,
} from './settingsApi';

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
  /** 保存されていない設定の値（既定のエージェントは MYMIND_AGENT から決める、FR-A07） */
  settingsDefaults?: Partial<AppSettings>;
  /** 起動の設定で決まる値（MYMIND_AGENT=fake で動いているか） */
  settingsRuntime?: SettingsRuntime;
  /** 業務日ごとの振り返り（FR-D06） */
  logs: DailyLogRepository;
};

const dayParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形式で指定してください');

/** タイムラインの表示期間の上限（FR-R01：1週間か2週間） */
const TIMELINE_MAX_DAYS = 14;

const timelineQuery = z
  .strictObject({ from: calendarDayParam, to: calendarDayParam })
  .refine((q) => q.from <= q.to, { message: 'from は to より前の日にしてください' })
  .refine((q) => daysBetween(q.from, q.to) < TIMELINE_MAX_DAYS, {
    message: `期間は${TIMELINE_MAX_DAYS}日までにしてください`,
  });

/** from から to までの業務日を順に並べる */
const periodDays = (from: string, to: string) => {
  const days = [from];
  for (let day = from; day < to; ) {
    day = nextDay(day);
    days.push(day);
  }
  return days;
};

/** タスク名の検索（FR-M02）。空白だけの語は受け付けない */
const searchQuery = z.strictObject({
  q: z
    .string()
    .trim()
    .min(1, '検索の語を入れてください')
    .max(100, '検索の語は100文字までにしてください'),
});

/** 更新系の API に共通する、画面が想定している状態（NFR-13、NFR-14） */
const screenState = {
  /** 画面が表示している業務日。現在の業務日と違えば、allowPastDay がない限り拒否する */
  expectedDay: dayParam,
  allowPastDay: z.boolean().optional(),
};

/** FR-R06：棚卸しの判断。1件ずつ判断するので、1回に1件を送る */
const reviewBody = z.strictObject({
  ...screenState,
  taskId: z.string().min(1),
  expectedVersion: z.number().int().min(1),
  decision: z.enum(REVIEW_DECISIONS),
});
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

/** 画面に返す月次総括（FR-A06、FR-R05）。日次 FB と同じく、中身はスキーマで検証し直す。読めない中身は null */
function toMonthlySummary(f: Feedback | undefined) {
  if (f === undefined) return null;
  const content = monthlySummarySchema.safeParse(f.content);
  return {
    id: f.id,
    period: f.period,
    agent: f.agent,
    promptVersion: f.promptVersion,
    isPartial: f.isPartial,
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
  | 'PLAN_CONFIRMED'
  | 'NOT_IN_BACKLOG'
  | 'NOT_REVIEW_TARGET';

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
  settingsDefaults = {},
  settingsRuntime = { fakeAgent: false },
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
    // 履歴と子は、行ごとに問い合わせずにまとめて読む（NFR-18）
    const ids = list.map((t) => t.id);
    const events = tasks.listEventsOfTasks(ids);
    const childrenOf = tasks.listChildrenOfMany(ids);
    return list.map((t) => {
      const children = childrenOf.get(t.id) ?? [];
      return {
        ...t,
        statusSince:
          statusSinceDay(events.get(t.id) ?? []) ??
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

  /**
   * カレンダーの1日分（FR-R04、FR-A09）。件数や有無はここで決め、画面では数えない。
   * 空白日は、計画も振り返りの記録もない日（architecture.md 4.5）。まだ来ていない日は中身を返さない
   */
  const monthDay = (
    day: string,
    today: string,
    records: DayRecordReader,
    completed: ReadonlyMap<string, number>,
  ) => {
    if (day > today) {
      return {
        day,
        isFuture: true,
        isBlank: false,
        completedCount: 0,
        hasReflection: false,
        hasFeedback: false,
        condition: null,
      };
    }
    const log = logs.find(day);
    const condition = jobs.jobs.findCondition(day);
    return {
      day,
      isFuture: false,
      isBlank: records.isBlank(day, log),
      completedCount: completed.get(day) ?? 0,
      hasReflection: hasReflection(log),
      hasFeedback: jobs.jobs.listFeedbacks('daily', day).length > 0,
      // FB を依頼していない日は調子を空にする（FR-A09）。手で付けた調子だけがある日もある
      condition:
        condition === undefined
          ? null
          : { aiLevel: condition.aiLevel, userLevel: condition.userLevel },
    };
  };

  const currentSettings = createSettingsReader(settings, settingsDefaults);

  /**
   * ステータスを変える（FR-T03、FR-T04）。domain の遷移表と自動ルールでイベントにし、1つのトランザクションで保存する（ADR-0004）。
   * 画面からの変更と、棚卸しの「中止」（FR-R06）で使う
   */
  const transitionTask = (
    task: Task,
    to: Status,
    expectedVersion: number,
    ctx: { at: string; day: string },
  ) => {
    const change = changeStatus({ taskId: task.id, from: task.status, to, ...ctx });
    if (!change.ok) {
      return {
        ok: false as const,
        kind: 'invalid_transition' as const,
        from: change.error.from,
        to: change.error.to,
      };
    }
    const parent = task.parentId === null ? undefined : tasks.find(task.parentId);
    const outcome = rulesOnStatusChange(
      {
        task: { ...task, status: to },
        parent: parent ?? null,
        siblings:
          parent === undefined ? [] : tasks.listChildren(parent.id).filter((t) => t.id !== task.id),
      },
      ctx,
    );
    const result = tasks.applyChanges([
      { taskId: task.id, expectedVersion, events: [change.value] },
      // 自動ルールで変わるタスクは画面が操作したものではないので、version は確かめない
      ...outcome.events.map((e) => ({ taskId: e.taskId, expectedVersion: null, events: [e] })),
    ]);
    if (!result.ok) return { ok: false as const, kind: 'conflict' as const, error: result.error };
    const [updated, ...affected] = result.value;
    return {
      ok: true as const,
      task: updated ?? task,
      affected,
      suggestions: outcome.suggestions,
    };
  };

  /** 今日・明日・バックログへ移す（FR-T05〜T08）。画面からの移動と、棚卸しの「今週やる」（FR-R06）で使う */
  const moveTask = (
    task: Task,
    target: 'today' | 'tomorrow' | 'backlog',
    expectedVersion: number,
    ctx: { at: string; day: string },
  ) => {
    const plan = planMove({
      taskId: task.id,
      plannedDays: tasks.listPlannedDays(task.id),
      today: ctx.day,
      target,
      at: ctx.at,
    });
    const outcome =
      target === 'backlog' ? rulesOnMoveToBacklog(task, ctx) : { events: [], suggestions: [] };
    const events = [...plan.events, ...outcome.events];
    if (events.length === 0) return { ok: true as const, task, suggestions: [] };
    const result = tasks.applyChanges([
      {
        taskId: task.id,
        expectedVersion,
        events,
        plan: { removeDays: plan.removeDays, addDay: plan.addDay },
      },
    ]);
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, task: result.value[0] ?? task, suggestions: outcome.suggestions };
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

    .get('/months/:ym', (c) => {
      const ym = monthParam.safeParse(c.req.param('ym'));
      if (!ym.success) return fail(c, 400, 'INVALID_REQUEST', '月の形式が正しくありません');
      const today = toBusinessDay(now(), dayOptions);
      const records = createDayRecordReader({ tasks, logs });
      const days = daysOfMonth(ym.data);
      const completed = records.completedCounts(days.filter((day) => day <= today));
      // まだ来ていない月も返す（カレンダーで先の月へ移れるように）。日ごとに isFuture で示す
      return c.json({
        ym: ym.data,
        today,
        // 最新の総括（FR-R05）と、生成中・失敗を出すための最新のジョブ（FR-A06、FR-A08）
        summary: toMonthlySummary(jobs.jobs.latestFeedback('monthly', ym.data)),
        summaryJob: jobs.jobs.latestJob('monthly_summary', ym.data) ?? null,
        days: days.map((day) => monthDay(day, today, records, completed)),
      });
    })

    .get('/timeline', (c) => {
      const query = timelineQuery.safeParse(c.req.query());
      if (!query.success) {
        return fail(
          c,
          400,
          'INVALID_REQUEST',
          query.error.issues[0]?.message ?? '期間が正しくありません',
        );
      }
      const { from, to } = query.data;
      const today = toBusinessDay(now(), dayOptions);
      // まだ来ていない日は描かない。期間がまるごと先なら、タスクは返さない
      const drawTo = to < today ? to : today;
      const list = from <= drawTo ? tasks.listTimelineTasks(from, drawTo) : [];
      const events = tasks.listEventsOfTasks(list.map((t) => t.id));
      const parentIds = [
        ...new Set(list.flatMap((t) => (t.parentId === null ? [] : [t.parentId]))),
      ];
      const parents = new Map(tasks.findMany(parentIds).map((p) => [p.id, p.title]));
      const rows = list.map((t) => {
        const history = events.get(t.id) ?? [];
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          parentTitle: t.parentId === null ? null : (parents.get(t.parentId) ?? null),
          segments: timelineSegments(history, { from, to: drawTo }),
          // 内訳は表示期間ではなく、着手してから今日までで数える（FR-R03）
          breakdown: timelineBreakdown(history, today),
        };
      });
      return c.json({
        from,
        to,
        today,
        // 調子のレーン（FR-R02）。FB を依頼していない日は空（FR-A09）
        days: periodDays(from, to).map((day) => {
          const condition = day <= today ? jobs.jobs.findCondition(day) : undefined;
          return {
            day,
            isFuture: day > today,
            condition:
              condition === undefined
                ? null
                : { aiLevel: condition.aiLevel, userLevel: condition.userLevel },
          };
        }),
        // 期間の中で先に描き始めるタスクを上に置く
        tasks: rows
          .filter((r) => r.segments.length > 0)
          .sort((a, b) => (a.segments[0]?.from ?? '').localeCompare(b.segments[0]?.from ?? '')),
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

    /**
     * 棚卸しの対象（FR-R06）：最後に触れてから設定の日数が経ったバックログのタスクを、触れたのが古い順に返す。
     * 日数はここで数え、画面では数えない
     */
    .get('/review/stale', (c) => {
      const today = toBusinessDay(now(), dayOptions);
      const { reviewAfterDays } = currentSettings();
      const touchedDay = (t: Task) => toBusinessDay(new Date(t.lastTouchedAt), dayOptions);
      const stale = tasks
        .listBacklog(today)
        .filter((t) => isReviewTarget(touchedDay(t), today, reviewAfterDays))
        .sort((a, b) => a.lastTouchedAt.localeCompare(b.lastTouchedAt));
      return c.json({
        today,
        afterDays: reviewAfterDays,
        tasks: withListInfo(stale).map((t) => ({
          ...t,
          createdDay: toBusinessDay(new Date(t.createdAt), dayOptions),
          daysSinceTouched: daysSinceTouched(touchedDay(t), today),
          // 「一度も着手されていません」と書くため。完了を取り消して戻した場合も着手したことがある
          hasStarted: tasks
            .listEvents(t.id)
            .some((e) => e.type === 'status_changed' && e.to === 'doing'),
        })),
      });
    })

    /** 棚卸しの判断を反映する（FR-R06、#135 の決定）。状態の変更は、画面の操作と同じ関数を通す */
    .post('/review/decisions', jsonBody(reviewBody), (c) => {
      const input = c.req.valid('json');
      const dayError = checkDay(c, input);
      if (dayError) return dayError;
      const task = tasks.find(input.taskId);
      if (task === undefined) {
        return fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません', { taskId: input.taskId });
      }
      if (!tasks.listBacklog(input.expectedDay).some((t) => t.id === task.id)) {
        return fail(c, 409, 'NOT_IN_BACKLOG', 'バックログにないタスクは棚卸しできません', {
          taskId: task.id,
        });
      }
      // 対象は、今の設定の日数が経ったタスクだけ（GET /review/stale に出ないタスクは判断させない）
      const touchedDay = toBusinessDay(new Date(task.lastTouchedAt), dayOptions);
      if (!isReviewTarget(touchedDay, input.expectedDay, currentSettings().reviewAfterDays)) {
        return fail(c, 409, 'NOT_REVIEW_TARGET', '棚卸しの対象ではないタスクです', {
          taskId: task.id,
        });
      }
      const ctx = { at: now().toISOString(), day: input.expectedDay };
      const action = planReviewDecision(input.decision);
      if (action.kind === 'touch') {
        const result = tasks.applyChanges([
          {
            taskId: task.id,
            expectedVersion: input.expectedVersion,
            events: [],
            touchedAt: ctx.at,
          },
        ]);
        if (!result.ok) return conflict(c, result.error);
        return c.json({ task: result.value[0] ?? task });
      }
      if (action.kind === 'move') {
        const result = moveTask(task, action.to, input.expectedVersion, ctx);
        if (!result.ok) return conflict(c, result.error);
        return c.json({ task: result.task });
      }
      const result = transitionTask(task, action.to, input.expectedVersion, ctx);
      if (!result.ok) {
        return result.kind === 'invalid_transition'
          ? fail(c, 422, 'INVALID_TRANSITION', 'このステータスには変えられません', {
              from: result.from,
              to: result.to,
            })
          : conflict(c, result.error);
      }
      return c.json({ task: result.task });
    })

    /** タスク名の部分一致で探す（FR-M02、MCP の search_tasks のため）。読み取りだけ */
    .get('/tasks/search', (c) => {
      const query = searchQuery.safeParse(c.req.query());
      if (!query.success) {
        return fail(
          c,
          400,
          'INVALID_REQUEST',
          query.error.issues[0]?.message ?? '検索の語が正しくありません',
        );
      }
      return c.json({ tasks: withListInfo(tasks.searchByTitle(query.data.q)) });
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
      const result = transitionTask(task, input.to, input.expectedVersion, ctx);
      if (!result.ok) {
        return result.kind === 'invalid_transition'
          ? fail(c, 422, 'INVALID_TRANSITION', 'このステータスには変えられません', {
              from: result.from,
              to: result.to,
            })
          : conflict(c, result.error);
      }
      return c.json({
        task: result.task,
        affected: result.affected,
        suggestions: result.suggestions,
      });
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
      const result = moveTask(task, input.to, input.expectedVersion, ctx);
      if (!result.ok) return conflict(c, result.error);
      return c.json({ task: result.task, suggestions: result.suggestions });
    });
  return taskRoutes
    .route('/', createJobsApi(jobs))
    .route('/', createHealthApi(health))
    .route('/', createSettingsApi(settings, settingsDefaults, settingsRuntime));
}

export type Api = ReturnType<typeof createApi>;
