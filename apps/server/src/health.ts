import { existsSync, readdirSync, statSync } from 'node:fs';
import type { AgentStatus } from '@mymind/agent';
import type { JobRepository } from '@mymind/db';
import { Hono } from 'hono';

export type HealthDeps = {
  /** DB に問い合わせられるか（SELECT 1） */
  checkDatabase: () => { ok: true } | { ok: false; message: string };
  /** DB のファイル（本体と -wal、-shm）。サイズの合計を返す */
  databaseFiles: string[];
  /** バックアップの置き場所（backups/） */
  backupsDir: string;
  jobs: Pick<JobRepository, 'latestFailure'>;
  /** 使うエージェントの状態（実行ファイルの有無とバージョン） */
  agentStatus: () => Promise<AgentStatus>;
};

export type LatestBackup = {
  file: string;
  /** pre-migration（マイグレーションの前）、before-restore（復元の前）など */
  kind: string;
  at: string;
  /** 書き出しを終えたファイルだけが残るので、ある以上は成功（毎日のバックアップの失敗は NFR-04 のスケジューラで記録する） */
  result: 'succeeded';
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
    if (latest === null || at > latest.at) latest = { file, kind, at, result: 'succeeded' };
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
      backup: findLatestBackup(deps.backupsDir),
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
