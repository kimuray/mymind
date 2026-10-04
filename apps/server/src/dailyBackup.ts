import type { DatabaseSync } from 'node:sqlite';
import { backupsDir, DAILY_BACKUP_TIME, runDailyBackup, writeDailyBackupStatus } from './backups';
import type { Logger } from './logger';
import type { ScheduledJob } from './scheduler';

export type DailyBackupDeps = {
  client: DatabaseSync;
  dataDir: string;
  /** 保存先（null ならデータディレクトリの backups/）と世代数。設定で変わるので、動かすたびに読む */
  settings: () => { backupDir: string | null; backupGenerations: number };
  now: () => Date;
  logger: Logger;
};

/** 毎日のバックアップの保存先。設定がなければデータディレクトリの backups/ */
export const dailyBackupDir = (dataDir: string, backupDir: string | null) =>
  backupDir ?? backupsDir(dataDir);

/**
 * 毎日のバックアップの予定（NFR-04、architecture.md 10章）。スケジューラに加えて使う。
 * 結果は成功・失敗とも記録し、状態の画面（NFR-21）に出す
 */
export function createDailyBackupJob(deps: DailyBackupDeps): ScheduledJob {
  return {
    id: 'daily-backup',
    spec: () => ({ time: DAILY_BACKUP_TIME }),
    run: () => {
      const { backupDir, backupGenerations } = deps.settings();
      const dir = dailyBackupDir(deps.dataDir, backupDir);
      const at = deps.now();
      const result = runDailyBackup(deps.client, dir, backupGenerations, at);
      if (result.ok) {
        deps.logger.info('毎日のバックアップを作りました', {
          path: result.value.path,
          removed: result.value.removed.length,
        });
      } else {
        deps.logger.error('毎日のバックアップに失敗しました', {
          dir,
          error: result.error.message,
        });
      }
      writeDailyBackupStatus(deps.dataDir, {
        at: at.toISOString(),
        result: result.ok ? 'succeeded' : 'failed',
        error: result.ok ? null : result.error.message,
      });
    },
  };
}
