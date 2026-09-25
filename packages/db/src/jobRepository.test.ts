import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, MIGRATIONS_FOLDER, openDatabase } from './client';
import { createJobRepository, type JobRepository } from './jobRepository';
import { conditions, feedbacks } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

const DAY = '2026-09-23';
const at = (minute: number) => `2026-09-23T12:${String(minute).padStart(2, '0')}:00.000Z`;
const reversingCodec: SensitiveCodec = {
  encode: (plain) => [...plain].reverse().join(''),
  decode: (stored) => [...stored].reverse().join(''),
};
const content = {
  condition: { level: 3, reason: '設計に集中できた' },
  good: ['午前に細かい作業を片付けた'],
  insight: [],
  next_action: '週報は朝いちばんに',
};

let db: Database;
let jobs: JobRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  jobs = createJobRepository({ db, codec: reversingCodec });
});

const createJob = (id = 'j1') =>
  jobs.create({ id, kind: 'daily_feedback', period: DAY, agent: 'fake', createdAt: at(0) });

const success = (jobId = 'j1') => ({
  jobId,
  finishedAt: at(5),
  feedback: {
    id: `f-${jobId}`,
    scope: 'daily' as const,
    period: DAY,
    content,
    agent: 'fake',
    promptVersion: '0.1.0',
    isPartial: false,
  },
  condition: { day: DAY, aiLevel: 3, aiReason: '設計に集中できた' },
});

describe('FR-A08 ジョブの登録と実行', () => {
  it('登録したジョブは待機中で、取り出すと実行中になる', () => {
    expect(createJob()).toMatchObject({ status: 'queued' });
    expect(jobs.claimNext(at(1))).toMatchObject({ id: 'j1', status: 'running', startedAt: at(1) });
    expect(jobs.find('j1')?.status).toBe('running');
  });

  it('古い順に取り出し、待機中がなければ何も返さない', () => {
    createJob('j1');
    createJob('j2');
    expect(jobs.claimNext(at(1))?.id).toBe('j1');
    expect(jobs.claimNext(at(1))?.id).toBe('j2');
    expect(jobs.claimNext(at(1))).toBeUndefined();
  });

  it('同じ日の、まだ終わっていないジョブを探せる', () => {
    createJob('j1');
    expect(jobs.findActive('daily_feedback', DAY)?.id).toBe('j1');
    jobs.cancel('j1', at(2));
    expect(jobs.findActive('daily_feedback', DAY)).toBeUndefined();
  });
});

describe('FR-A02 FB と調子の保存', () => {
  it('成功すると、FB と調子を保存してジョブを完了にする', () => {
    createJob();
    jobs.claimNext(at(1));
    expect(jobs.succeed(success())).toBe(true);
    expect(jobs.find('j1')).toMatchObject({ status: 'succeeded', finishedAt: at(5) });
    expect(jobs.listFeedbacks('daily', DAY)).toMatchObject([
      { id: 'f-j1', jobId: 'j1', content, promptVersion: '0.1.0' },
    ]);
    expect(jobs.findCondition(DAY)).toMatchObject({ aiLevel: 3, aiReason: '設計に集中できた' });
  });

  it('FB を再依頼しても、過去の FB は残し、新しい順に返す（FR-A04）', () => {
    for (const id of ['j1', 'j2']) {
      createJob(id);
      jobs.claimNext(at(1));
      jobs.succeed(success(id));
    }
    expect(jobs.listFeedbacks('daily', DAY).map((f) => f.id)).toEqual(['f-j2', 'f-j1']);
  });

  it('手動で修正した調子は、AI の判定を更新しても残す（FR-A03）', () => {
    db.insert(conditions)
      .values({ day: DAY, userLevel: 1, updatedAt: at(0) })
      .run();
    createJob();
    jobs.claimNext(at(1));
    jobs.succeed(success());
    expect(jobs.findCondition(DAY)).toMatchObject({ aiLevel: 3, userLevel: 1 });
  });

  it('FB の本文と調子の根拠は SensitiveCodec を通して保存する（ADR-0009）', () => {
    createJob();
    jobs.claimNext(at(1));
    jobs.succeed(success());
    const stored = db.select().from(feedbacks).where(eq(feedbacks.id, 'f-j1')).get();
    expect(stored?.contentJson).toBe(reversingCodec.encode(JSON.stringify(content)));
    const cond = db.select().from(conditions).where(eq(conditions.day, DAY)).get();
    expect(cond?.aiReason).toBe(reversingCodec.encode('設計に集中できた'));
  });

  it('実行中でないジョブは成功にできず、何も保存しない', () => {
    createJob();
    expect(jobs.succeed(success())).toBe(false);
    expect(jobs.listFeedbacks('daily', DAY)).toEqual([]);
  });
});

describe('FR-A08 失敗とキャンセル', () => {
  it('実行中のジョブを、理由と一緒に失敗にする', () => {
    createJob();
    jobs.claimNext(at(1));
    expect(jobs.fail('j1', 'タイムアウトしました', at(3))).toBe(true);
    expect(jobs.find('j1')).toMatchObject({ status: 'failed', error: 'タイムアウトしました' });
  });

  it('待機中のジョブも、実行中のジョブもキャンセルできる', () => {
    createJob('j1');
    createJob('j2');
    jobs.claimNext(at(1));
    expect(jobs.cancel('j1', at(2))).toBe(true);
    expect(jobs.cancel('j2', at(2))).toBe(true);
  });

  it('終わったジョブはキャンセルできない', () => {
    createJob();
    jobs.claimNext(at(1));
    jobs.succeed(success());
    expect(jobs.cancel('j1', at(6))).toBe(false);
    expect(jobs.find('j1')?.status).toBe('succeeded');
  });

  it('起動時に、実行中のまま残ったジョブを「中断」で失敗にする（architecture.md 7.6）', () => {
    createJob('j1');
    createJob('j2');
    jobs.claimNext(at(1));
    expect(jobs.failInterrupted(at(9)).map((j) => j.id)).toEqual(['j1']);
    expect(jobs.find('j1')).toMatchObject({
      status: 'failed',
      error: 'サーバーの停止で中断しました',
    });
    // 待機中のジョブは残し、再起動後に実行する
    expect(jobs.find('j2')?.status).toBe('queued');
  });
});

describe('NFR-21 直近の失敗', () => {
  it('失敗がなければ undefined', () => {
    createJob('j1');
    jobs.claimNext(at(1));
    jobs.succeed(success('j1'));
    expect(jobs.latestFailure()).toBeUndefined();
  });

  it('いちばん新しく終わった失敗を返す', () => {
    createJob('j1');
    createJob('j2');
    jobs.claimNext(at(1));
    jobs.fail('j1', '古い失敗', at(3));
    jobs.claimNext(at(4));
    jobs.fail('j2', '新しい失敗', at(7));
    expect(jobs.latestFailure()).toMatchObject({ id: 'j2', error: '新しい失敗' });
  });
});
