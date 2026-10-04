import {
  type AgentInput,
  buildDailyFeedbackInput,
  buildMonthlySummaryInput,
  type DailyFeedbackData,
  type DailyPayload,
  dailyFeedbackSchema,
  type MonthlyPayload,
  type MonthlySummaryData,
  RECENT_DAYS,
} from '@mymind/agent';
import type { DailyLogRepository, JobRepository, TaskRepository } from '@mymind/db';
import {
  dayOrdinalSince,
  daysOfMonth,
  type JobKind,
  previousDays,
  statusSinceDay,
} from '@mymind/domain';
import { createDayRecordReader, hasReflection } from './dayRecords';

export type AgentInputDeps = {
  tasks: TaskRepository;
  jobs: JobRepository;
  logs: DailyLogRepository;
  /** 日次 FB のプロンプト（prompts/daily-feedback.md） */
  promptText: string;
  /** 月次総括のプロンプト（prompts/monthly-summary.md） */
  monthlyPromptText: string;
  /** 今の業務日（月の途中かどうかと、まだ来ていない月を判断する） */
  today: () => string;
};

export type BuildInputResult =
  | { ok: true; kind: 'daily_feedback'; input: AgentInput<DailyPayload> }
  | { ok: true; kind: 'monthly_summary'; input: AgentInput<MonthlyPayload> }
  | { ok: false; reason: 'invalid_period'; message: string };

/**
 * エージェントに渡す入力を DB から組み立てる（architecture.md 12.5）。
 * 送信内容のプレビュー（FR-A12）と実際の依頼の両方がこの関数を使うので、表示する内容と送る内容は一致する
 */
export function createAgentInputBuilder({
  tasks,
  jobs,
  logs,
  promptText,
  monthlyPromptText,
  today,
}: AgentInputDeps) {
  /** その日の計画と直近の日から、日次 FB の元のデータを集める。件数と日数はここで数える（FR-A10） */
  const dailyData = (day: string): DailyFeedbackData => {
    const plan = tasks.listPlan(day);
    const parentIds = [...new Set(plan.flatMap((t) => (t.parentId === null ? [] : [t.parentId])))];
    const parents = new Map(tasks.findMany(parentIds).map((p) => [p.id, p.title]));
    const count = (s: string) => plan.filter((t) => t.status === s).length;
    return {
      day,
      tasks: plan.map((t) => ({
        title: t.title,
        status: t.status,
        parentTitle: t.parentId === null ? null : (parents.get(t.parentId) ?? null),
        // 作成のイベントは必ずあるので、見つからないのはその日に作られた場合と同じに扱う
        statusDays: dayOrdinalSince(statusSinceDay(tasks.listEvents(t.id)) ?? day, day),
      })),
      counts: {
        planned: plan.length,
        done: count('done'),
        doing: count('doing'),
        paused: count('paused'),
        waiting: count('waiting'),
      },
      reflection: reflectionOf(day),
      recent: previousDays(day, RECENT_DAYS).map(recentDay),
    };
  };

  /** その日の振り返り。保存していないか、どちらの欄も空なら送らない */
  const reflectionOf = (day: string): DailyFeedbackData['reflection'] => {
    const log = logs.find(day);
    if (log === undefined || (log.thoughtsMd.trim() === '' && log.learningMd.trim() === '')) {
      return null;
    }
    return { thoughtsMd: log.thoughtsMd, learningMd: log.learningMd };
  };

  /** 直近の1日：調子（手動の値を優先）、最新の FB の「明日の一手」、空白日かどうか */
  const recentDay = (day: string): DailyFeedbackData['recent'][number] => {
    const condition = jobs.findCondition(day);
    const latest = jobs.listFeedbacks('daily', day)[0];
    const content = dailyFeedbackSchema.safeParse(latest?.content);
    return {
      day,
      level: condition?.userLevel ?? condition?.aiLevel ?? null,
      nextAction: content.success ? content.data.next_action : null,
      // 計画も振り返りも調子も FB もない日は、アプリを開かなかった日（空白日、architecture.md 4.5）
      isBlank:
        tasks.listPlan(day).length === 0 &&
        logs.find(day) === undefined &&
        condition === undefined &&
        latest === undefined,
    };
  };

  /**
   * 月次総括の元のデータ（FR-A06、architecture.md 12.5）。月の初日から、月の途中なら今日まで、過ぎた月なら月末まで。
   * 日数と件数はここで数え、AI には数えさせない（FR-A10）
   */
  const monthlyData = (month: string, until: string): MonthlySummaryData => {
    const records = createDayRecordReader({ tasks, logs });
    const days = daysOfMonth(month).filter((day) => day <= until);
    const through = days.at(-1) ?? `${month}-01`;
    const rows = days.map((day) => {
      const log = logs.find(day);
      const condition = jobs.findCondition(day);
      const content = dailyFeedbackSchema.safeParse(jobs.listFeedbacks('daily', day)[0]?.content);
      return {
        day,
        isBlank: records.isBlank(day, log),
        condition:
          condition === undefined ? null : { ai: condition.aiLevel, user: condition.userLevel },
        feedback: content.success
          ? {
              good: content.data.good,
              insight: content.data.insight,
              nextAction: content.data.next_action,
            }
          : null,
        reflection: hasReflection(log)
          ? { thoughtsMd: log.thoughtsMd, learningMd: log.learningMd }
          : null,
        completed: records.completedCount(day),
      };
    });
    return {
      month,
      isPartial: through < (daysOfMonth(month).at(-1) ?? through),
      through,
      stats: {
        recordedDays: rows.filter((r) => !r.isBlank).length,
        blankDays: rows.filter((r) => r.isBlank).length,
        feedbackDays: rows.filter((r) => r.feedback !== null).length,
        correctedDays: rows.filter(
          (r) =>
            r.condition !== null &&
            r.condition.user !== null &&
            r.condition.user !== r.condition.ai,
        ).length,
        completed: rows.reduce((sum, r) => sum + r.completed, 0),
      },
      days: rows.map(({ completed: _, ...row }) => row),
    };
  };

  return {
    build(kind: JobKind, period: string): BuildInputResult {
      const now = today();
      if (kind === 'monthly_summary') {
        // まだ始まっていない月の総括は作れない。月の途中なら、今日までの途中経過にする
        if (`${period}-01` > now) {
          return { ok: false, reason: 'invalid_period', message: 'まだ来ていない月です' };
        }
        return {
          ok: true,
          kind,
          input: buildMonthlySummaryInput(monthlyPromptText, monthlyData(period, now)),
        };
      }
      return { ok: true, kind, input: buildDailyFeedbackInput(promptText, dailyData(period)) };
    },
  };
}

export type AgentInputBuilder = ReturnType<typeof createAgentInputBuilder>;
