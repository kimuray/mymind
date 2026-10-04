import { existsSync, readdirSync, statSync } from 'node:fs';
import type { AgentStatus } from '@mymind/agent';
import type { JobRepository } from '@mymind/db';
import { Hono } from 'hono';

export type HealthDeps = {
  /** DB に問い合わせられるか（SELECT 1） */
  checkDatabase: () => { ok: true } | { ok: false; message: string };
  /** DB のファイル（本体と -wal、-shm）。サイズの合計を返す */
  databaseFiles: string[];
  /** バックアップの置き場所。データディレクトリの backups/ と、設定した毎日のバックアップの保存先 */
  backupsDirs: () => string[];
  /** 最後の毎日のバックアップの結果。失敗はファイルが残らないので、こちらで知る */
  dailyBackup: () => { at: string; result: 'succeeded' | 'failed'; error: string | null } | null;
  jobs: Pick<JobRepository, 'latestFailure'>;
  /** 使うエージェントの状態（実行ファイルの有無とバージョン） */
  agentStatus: () => Promise<AgentStatus>;
};

export type LatestBackup = {
  /** 失敗したときは null */
  file: string | null;
  /** pre-migration（マイグレーションの前）、before-restore（復元の前）など */
  kind: string;
  at: string;
  /** ファイルは書き出しを終えたものだけが残るので成功。毎日のバックアップの失敗は、記録した結果から出す */
  result: 'succeeded' | 'failed';
  /** 失敗の理由 */
  error: string | null;
};

/** backups/<種類>-<20260925T075324Z>.db のうち、いちばん新しいもの */
export function findLatestBackup(dir: string): LatestBackup | null {
  if (!existsSync(dir)) return null;
  let latest: LatestBackup | null = null;
  for (const file of readdirSync(dir)) {
    const m = file.match(/^(.+)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/);
    if (m === null) continue;
    const [, kind = '', y, mo, d, h, mi, s] = m;
    const at = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
    if (latest === null || at > latest.at)
      latest = { file, kind, at, result: 'succeeded', error: null };
  }
  return latest;
}

/**
 * 状態の画面に出す最後のバックアップ。どの置き場所のファイルより、毎日のバックアップの失敗が新しければ失敗を出す
 * （成功したのに古いファイルを見せて、止まっていることに気づけないのを防ぐ、NFR-23）
 */
export function latestBackupOf(
  deps: Pick<HealthDeps, 'backupsDirs' | 'dailyBackup'>,
): LatestBackup | null {
  let latest: LatestBackup | null = null;
  for (const dir of new Set(deps.backupsDirs())) {
    const found = findLatestBackup(dir);
    if (found !== null && (latest === null || found.at > latest.at)) latest = found;
  }
  const daily = deps.dailyBackup();
  if (daily?.result === 'failed' && (latest === null || daily.at > latest.at)) {
    return { file: null, kind: 'daily', at: daily.at, result: 'failed', error: daily.error };
  }
  return latest;
}

const sizeOf = (files: string[]) =>
  files.reduce((sum, f) => sum + (existsSync(f) ? statSync(f).size : 0), 0);

/**
 * 状態の見える化（NFR-21、architecture.md 12.8）。
 * DB、エージェント、最後のバックアップ、直近の FB 生成の失敗を返す。読むだけなので、トークンは求めない
 */
export function createHealthApi(deps: HealthDeps) {
  return new Hono().get('/health', async (c) => {
    const database = deps.checkDatabase();
    const agent = await deps.agentStatus();
    const failure = deps.jobs.latestFailure();
    const body = {
      status: database.ok && agent.usable ? ('ok' as const) : ('degraded' as const),
      database: {
        ok: database.ok,
        message: database.ok ? null : database.message,
        sizeBytes: sizeOf(deps.databaseFiles),
      },
      agent,
      backup: latestBackupOf(deps),
      recentFailure:
        failure === undefined
          ? null
          : {
              jobId: failure.id,
              kind: failure.kind,
              period: failure.period,
              error: failure.error,
              finishedAt: failure.finishedAt,
            },
    };
    // DB に問い合わせられなければ、ほかの機能も動かないので 503 にする
    return c.json(body, database.ok ? 200 : 503);
  });
}
