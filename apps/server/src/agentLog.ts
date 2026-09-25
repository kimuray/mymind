import { chmodSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** エージェントの入出力のログの1件（architecture.md 7.5）。ジョブごとに全文を残す */
export type AgentLogRecord = {
  jobId: string;
  kind: string;
  period: string;
  agent: string;
  promptVersion: string;
  input: string;
  /** 試した回数ぶんの出力または失敗の理由（形式違反は1回だけ再試行する） */
  attempts: ({ output: string } | { error: string })[];
  status: string;
  finishedAt: string;
};

/** 保存の期間（ADR-0009：ローカルにだけ保存し、30 日で消す） */
export const AGENT_LOG_RETENTION_DAYS = 30;

const isDayDir = (name: string) => /^\d{4}-\d{2}-\d{2}$/.test(name);

/**
 * エージェントの入出力のログ。機微データを含むので、ディレクトリは 700、ファイルは 600 で作る（ADR-0009）。
 * ロガーには出さず、ここにだけ残す。
 */
export function createAgentLog(dir: string) {
  const ensureDir = (path: string) => {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  };

  return {
    /** day（業務日）ごとのディレクトリに、ジョブ ID の名前で書く */
    write(day: string, record: AgentLogRecord): string {
      const dayDir = join(dir, day);
      ensureDir(dir);
      ensureDir(dayDir);
      const path = join(dayDir, `${record.jobId}.json`);
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      chmodSync(path, 0o600);
      return path;
    },

    /** today から数えて保存の期間を過ぎた日付のディレクトリを消す。消した日付を返す */
    prune(today: string, retentionDays = AGENT_LOG_RETENTION_DAYS): string[] {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      }
      const [y, m, d] = today.split('-').map(Number);
      const cutoff = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) - retentionDays))
        .toISOString()
        .slice(0, 10);
      const removed = names.filter((name) => isDayDir(name) && name < cutoff);
      for (const name of removed) rmSync(join(dir, name), { recursive: true, force: true });
      return removed;
    },
  };
}

export type AgentLog = ReturnType<typeof createAgentLog>;
