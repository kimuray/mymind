import {
  type AgentRunner,
  buildDailyFeedbackInput,
  type DailyFeedbackData,
  dailyFeedbackSchema,
  parseDailyFeedback,
  RECENT_DAYS,
  withTimeout,
} from '@mymind/agent';
import type { Job, JobRepository, TaskRepository } from '@mymind/db';
import { dayOrdinalSince, type JobKind, previousDays, statusSinceDay } from '@mymind/domain';
import type { AgentLog, AgentLogRecord } from './agentLog';
import type { EventBus } from './events';
import type { Logger } from './logger';

export type JobRunnerDeps = {
  jobs: JobRepository;
  tasks: TaskRepository;
  runner: AgentRunner;
  events: EventBus;
  /** 日次 FB のプロンプト（prompts/daily-feedback.md）とそのバージョン */
  prompt: { text: string; version: string };
  now: () => Date;
  newId: () => string;
  /** エージェントの待ち時間の上限（architecture.md 7.4 の初期値は 120 秒） */
  timeoutMs: number;
  /** エージェントの入出力の全文を残す場所（ADR-0009）。省略するとログを残さない */
  agentLog?: AgentLog;
  /** ジョブの失敗などを出すロガー（機微データは伏せ字になる） */
  logger?: Logger;
};

export type CancelResult = { ok: true; job: Job } | { ok: false; reason: 'not_found' | 'finished' };

/**
 * エージェントのジョブを1件ずつ実行する（architecture.md 7.1、同時実行は1件）。
 * 依頼はすぐに queued で返し、実行の進み具合は EventBus で画面に知らせる。
 */
export function createJobRunner(deps: JobRunnerDeps) {
  const { jobs, events } = deps;
  const controllers = new Map<string, AbortController>();
  let loop: Promise<void> | null = null;

  const iso = () => deps.now().toISOString();
  const publish = (id: string) => {
    const job = jobs.find(id);
    if (job !== undefined) events.publish({ type: 'job.updated', job });
  };

  /** その日の計画と直近の日から、日次 FB の元のデータを集める。件数と日数はここで数える（FR-A10） */
  const dailyData = (day: string): DailyFeedbackData => {
    const plan = deps.tasks.listPlan(day);
    const parentIds = [...new Set(plan.flatMap((t) => (t.parentId === null ? [] : [t.parentId])))];
    const parents = new Map(deps.tasks.findMany(parentIds).map((p) => [p.id, p.title]));
    const count = (s: string) => plan.filter((t) => t.status === s).length;
    return {
      day,
      tasks: plan.map((t) => ({
        title: t.title,
        status: t.status,
        parentTitle: t.parentId === null ? null : (parents.get(t.parentId) ?? null),
        // 作成のイベントは必ずあるので、見つからないのはその日に作られた場合と同じに扱う
        statusDays: dayOrdinalSince(statusSinceDay(deps.tasks.listEvents(t.id)) ?? day, day),
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
      isBlank:
        deps.tasks.listPlan(day).length === 0 && condition === undefined && latest === undefined,
    };
  };

  /** 1件を実行する。形式が違えば1回だけ再試行する（architecture.md 7.1） */
  const execute = async (job: Job) => {
    if (job.kind !== 'daily_feedback') {
      jobs.fail(job.id, '月次総括はまだ依頼できません', iso());
      return;
    }
    const controller = new AbortController();
    controllers.set(job.id, controller);
    const agentInput = buildDailyFeedbackInput(deps.prompt.text, dailyData(job.period));
    const input = agentInput.text;
    const attempts: AgentLogRecord['attempts'] = [];
    try {
      let lastError = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        const t = withTimeout(controller.signal, deps.timeoutMs);
        const result = await deps.runner.run(input, { signal: t.signal });
        t.dispose();
        attempts.push(result.ok ? { output: result.output } : { error: result.error.message });
        if (!result.ok) {
          if (t.timedOut()) {
            jobs.fail(
              job.id,
              `${deps.timeoutMs / 1000}秒以内に応答がなかったため中止しました`,
              iso(),
            );
          } else if (result.error.kind !== 'cancelled') {
            jobs.fail(job.id, result.error.message, iso());
          }
          // キャンセルは cancel() で記録済み
          return;
        }
        const parsed = parseDailyFeedback(result.output);
        if (parsed.ok) {
          const fb = parsed.value;
          jobs.succeed({
            jobId: job.id,
            finishedAt: iso(),
            feedback: {
              id: deps.newId(),
              scope: 'daily',
              period: job.period,
              content: fb,
              agent: deps.runner.name,
              promptVersion: deps.prompt.version,
              isPartial: false,
            },
            condition: {
              day: job.period,
              aiLevel: fb.condition.level,
              aiReason: fb.condition.reason,
            },
          });
          return;
        }
        lastError = parsed.error;
      }
      jobs.fail(job.id, `エージェントの出力の形式が正しくありませんでした（${lastError}）`, iso());
    } finally {
      controllers.delete(job.id);
      recordAgentLog(job, agentInput, attempts);
      publish(job.id);
    }
  };

  /** 入出力の全文をローカルのログに残し、期間を過ぎたログを消す。失敗の理由はロガーにも出す（本文は出さない） */
  const recordAgentLog = (
    job: Job,
    input: { text: string; annotations: AgentLogRecord['annotations']; charCount: number },
    attempts: AgentLogRecord['attempts'],
  ) => {
    const finished = jobs.find(job.id);
    if (finished?.status === 'failed') {
      deps.logger?.warn('FB の生成に失敗しました', {
        jobId: job.id,
        period: job.period,
        error: finished.error,
      });
    }
    if (deps.agentLog === undefined || attempts.length === 0) return;
    try {
      deps.agentLog.write(job.period, {
        jobId: job.id,
        kind: job.kind,
        period: job.period,
        agent: deps.runner.name,
        promptVersion: deps.prompt.version,
        input: input.text,
        annotations: input.annotations,
        charCount: input.charCount,
        attempts,
        status: finished?.status ?? 'unknown',
        finishedAt: iso(),
      });
      deps.agentLog.prune(iso().slice(0, 10));
    } catch (e) {
      // ログが書けなくても FB の結果は保存済みなので、ジョブは失敗にしない
      deps.logger?.error('エージェントの入出力のログを書けませんでした', {
        jobId: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const drain = async () => {
    for (let job = jobs.claimNext(iso()); job !== undefined; job = jobs.claimNext(iso())) {
      publish(job.id);
      await execute(job);
    }
  };

  /** 待機中のジョブがあれば実行を始める。実行中なら何もしない（同時実行は1件） */
  const kick = () => {
    if (loop !== null) return;
    loop = drain().finally(() => {
      loop = null;
    });
  };

  return {
    /** 起動時の処理：前回の停止で中断されたジョブを失敗にし、残っている待機中のジョブを実行する */
    start() {
      for (const job of jobs.failInterrupted(iso())) events.publish({ type: 'job.updated', job });
      kick();
    },

    /** FB を依頼する。同じ期間のジョブがまだ終わっていなければ、新しく作らずにそれを返す */
    enqueue(kind: JobKind, period: string): { job: Job; created: boolean } {
      const active = jobs.findActive(kind, period);
      if (active !== undefined) return { job: active, created: false };
      const job = jobs.create({
        id: deps.newId(),
        kind,
        period,
        agent: deps.runner.name,
        createdAt: iso(),
      });
      publish(job.id);
      kick();
      return { job, created: true };
    },

    /** 待機中なら取り消し、実行中ならエージェントを止める（FR-A08） */
    cancel(id: string): CancelResult {
      const job = jobs.find(id);
      if (job === undefined) return { ok: false, reason: 'not_found' };
      if (!jobs.cancel(id, iso())) return { ok: false, reason: 'finished' };
      controllers.get(id)?.abort();
      publish(id);
      const cancelled = jobs.find(id);
      return cancelled === undefined
        ? { ok: false, reason: 'not_found' }
        : { ok: true, job: cancelled };
    },

    /** 実行中のジョブがすべて終わるまで待つ（テストと停止時に使う） */
    idle: async () => {
      while (loop !== null) await loop;
    },
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
