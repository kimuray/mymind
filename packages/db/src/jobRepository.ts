import { canTransitionJob, type JobKind, type JobStatus } from '@mymind/domain';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from './client';
import { agentJobs, conditions, feedbacks } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

export type Job = typeof agentJobs.$inferSelect;

export type Feedback = {
  id: string;
  scope: 'daily' | 'monthly';
  period: string;
  jobId: string | null;
  /** エージェントの出力（検証済みの JSON）。保存するときは文字列にして SensitiveCodec を通す */
  content: unknown;
  agent: string;
  promptVersion: string;
  isPartial: boolean;
  createdAt: string;
};

export type Condition = {
  day: string;
  aiLevel: number | null;
  aiReason: string | null;
  userLevel: number | null;
  updatedAt: string;
};

export type JobSuccess = {
  jobId: string;
  finishedAt: string;
  feedback: Omit<Feedback, 'jobId' | 'createdAt'>;
  /** 日次 FB の調子（FR-A02）。月次総括では null */
  condition: { day: string; aiLevel: number; aiReason: string } | null;
};

/**
 * エージェントのジョブと、その結果（FB と調子）を保存する（architecture.md 7.1）。
 * 状態の変更は domain の canTransitionJob に照らし、できない変更は何も書かずに false を返す。
 */
export function createJobRepository({ db, codec }: { db: Database; codec: SensitiveCodec }) {
  type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

  /** 今の状態から to へ変えられるときだけ、状態と時刻を書き換える */
  const move = (
    tx: Tx,
    jobId: string,
    to: JobStatus,
    patch: Partial<Pick<Job, 'error' | 'startedAt' | 'finishedAt'>>,
  ): boolean => {
    const job = tx.select().from(agentJobs).where(eq(agentJobs.id, jobId)).get();
    if (job === undefined || !canTransitionJob(job.status, to)) return false;
    tx.update(agentJobs)
      .set({ status: to, ...patch })
      .where(eq(agentJobs.id, jobId))
      .run();
    return true;
  };

  const toFeedback = (row: typeof feedbacks.$inferSelect): Feedback => ({
    ...row,
    content: JSON.parse(codec.decode(row.contentJson)) as unknown,
  });

  return {
    create(input: {
      id: string;
      kind: JobKind;
      period: string;
      agent: string;
      createdAt: string;
    }): Job {
      return db
        .insert(agentJobs)
        .values({ ...input, status: 'queued' })
        .returning()
        .get();
    },

    find(id: string): Job | undefined {
      return db.select().from(agentJobs).where(eq(agentJobs.id, id)).get();
    },

    /** 同じ種類・期間の、まだ終わっていないジョブ（二重に依頼しないため） */
    findActive(kind: JobKind, period: string): Job | undefined {
      return db
        .select()
        .from(agentJobs)
        .where(
          and(
            eq(agentJobs.kind, kind),
            eq(agentJobs.period, period),
            inArray(agentJobs.status, ['queued', 'running']),
          ),
        )
        .get();
    },

    /** 一番古い待機中のジョブを実行中にして返す。なければ undefined */
    claimNext(startedAt: string): Job | undefined {
      return db.transaction((tx) => {
        const next = tx
          .select()
          .from(agentJobs)
          .where(eq(agentJobs.status, 'queued'))
          .orderBy(asc(agentJobs.id))
          .get();
        if (next === undefined || !move(tx, next.id, 'running', { startedAt })) return undefined;
        return { ...next, status: 'running' as const, startedAt };
      });
    },

    /** 成功：FB の保存、調子の更新、ジョブの完了を1つのトランザクションで行う（FR-A02、FR-A04） */
    succeed(result: JobSuccess): boolean {
      return db.transaction((tx) => {
        if (!move(tx, result.jobId, 'succeeded', { finishedAt: result.finishedAt })) return false;
        const { content, ...feedback } = result.feedback;
        // 過去の FB は上書きせず、履歴として残す（FR-A04）
        tx.insert(feedbacks)
          .values({
            ...feedback,
            jobId: result.jobId,
            contentJson: codec.encode(JSON.stringify(content)),
            createdAt: result.finishedAt,
          })
          .run();
        if (result.condition !== null) {
          const { day, aiLevel, aiReason } = result.condition;
          // 手動で修正した調子（user_level）は残し、AI の判定だけを更新する（FR-A03）
          tx.insert(conditions)
            .values({
              day,
              aiLevel,
              aiReason: codec.encode(aiReason),
              updatedAt: result.finishedAt,
            })
            .onConflictDoUpdate({
              target: conditions.day,
              set: { aiLevel, aiReason: codec.encode(aiReason), updatedAt: result.finishedAt },
            })
            .run();
        }
        return true;
      });
    },

    fail(jobId: string, error: string, finishedAt: string): boolean {
      return db.transaction((tx) => move(tx, jobId, 'failed', { error, finishedAt }));
    },

    cancel(jobId: string, finishedAt: string): boolean {
      return db.transaction((tx) => move(tx, jobId, 'cancelled', { finishedAt }));
    },

    /** 起動時：前回のサーバーの停止で実行中のまま残ったジョブを失敗にする（architecture.md 7.6） */
    failInterrupted(finishedAt: string): Job[] {
      return db.transaction((tx) => {
        const running = tx.select().from(agentJobs).where(eq(agentJobs.status, 'running')).all();
        for (const job of running) {
          move(tx, job.id, 'failed', { error: 'サーバーの停止で中断しました', finishedAt });
        }
        return running.map((j) => ({
          ...j,
          status: 'failed' as const,
          error: 'サーバーの停止で中断しました',
          finishedAt,
        }));
      });
    },

    /** 直近に失敗したジョブ（NFR-21：設定画面と /api/health で見せる）。なければ undefined */
    latestFailure(): Job | undefined {
      return db
        .select()
        .from(agentJobs)
        .where(eq(agentJobs.status, 'failed'))
        .orderBy(desc(agentJobs.finishedAt), desc(agentJobs.id))
        .get();
    },

    /** FB の履歴を新しい順に返す（FR-A04） */
    listFeedbacks(scope: 'daily' | 'monthly', period: string): Feedback[] {
      return db
        .select()
        .from(feedbacks)
        .where(and(eq(feedbacks.scope, scope), eq(feedbacks.period, period)))
        .orderBy(desc(feedbacks.id))
        .all()
        .map(toFeedback);
    },

    findCondition(day: string): Condition | undefined {
      const row = db.select().from(conditions).where(eq(conditions.day, day)).get();
      if (row === undefined) return undefined;
      return { ...row, aiReason: row.aiReason === null ? null : codec.decode(row.aiReason) };
    },
  };
}

export type JobRepository = ReturnType<typeof createJobRepository>;
