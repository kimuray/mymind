import {
  type AgentInput,
  buildDailyFeedbackInput,
  type DailyFeedbackData,
  type DailyPayload,
  dailyFeedbackSchema,
  RECENT_DAYS,
} from '@mymind/agent';
import type { JobRepository, TaskRepository } from '@mymind/db';
import { dayOrdinalSince, type JobKind, previousDays, statusSinceDay } from '@mymind/domain';

export type AgentInputDeps = {
  tasks: TaskRepository;
  jobs: JobRepository;
  /** 日次 FB のプロンプト（prompts/daily-feedback.md） */
  promptText: string;
};

export type BuildInputResult =
  | { ok: true; input: AgentInput<DailyPayload> }
  | { ok: false; reason: 'unsupported_kind'; message: string };

/**
 * エージェントに渡す入力を DB から組み立てる（architecture.md 12.5）。
 * 送信内容のプレビュー（FR-A12）と実際の依頼の両方がこの関数を使うので、表示する内容と送る内容は一致する
 */
export function createAgentInputBuilder({ tasks, jobs, promptText }: AgentInputDeps) {
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
      // 振り返りのテーブル（daily_logs）は、振り返りの画面の issue で作る
      reflection: null,
      recent: previousDays(day, RECENT_DAYS).map(recentDay),
    };
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
      // 計画も調子も FB もない日は、アプリを開かなかった日（空白日、architecture.md 4.5）
      isBlank: tasks.listPlan(day).length === 0 && condition === undefined && latest === undefined,
    };
  };

  return {
    build(kind: JobKind, period: string): BuildInputResult {
      if (kind !== 'daily_feedback') {
        return { ok: false, reason: 'unsupported_kind', message: '月次総括はまだ依頼できません' };
      }
      return { ok: true, input: buildDailyFeedbackInput(promptText, dailyData(period)) };
    },
  };
}

export type AgentInputBuilder = ReturnType<typeof createAgentInputBuilder>;
