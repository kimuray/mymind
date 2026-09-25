import {
  type AgentRunner,
  buildDailyFeedbackInput,
  type DailyFeedbackData,
  parseDailyFeedback,
  withTimeout,
} from '@mymind/agent';
import type { Job, JobRepository, TaskRepository } from '@mymind/db';
import type { JobKind } from '@mymind/domain';
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

  /** その日の計画から、日次 FB の入力を作る。件数はここで数える（FR-A10） */
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
      })),
      counts: {
        planned: plan.length,
        done: count('done'),
        doing: count('doing'),
        paused: count('paused'),
        waiting: count('waiting'),
      },
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
    const input = buildDailyFeedbackInput(deps.prompt.text, dailyData(job.period));
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
      recordAgentLog(job, input, attempts);
      publish(job.id);
    }
  };

  /** 入出力の全文をローカルのログに残し、期間を過ぎたログを消す。失敗の理由はロガーにも出す（本文は出さない） */
  const recordAgentLog = (job: Job, input: string, attempts: AgentLogRecord['attempts']) => {
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
        input,
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
