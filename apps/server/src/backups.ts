import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeSnapshot } from '@mymind/db';
import { z } from 'zod';
import { acquireLock } from './dataDir';

/** バックアップの置き場所（データディレクトリの中。ディレクトリは 700、ファイルは 600、ADR-0009） */
export const backupsDir = (dataDir: string) => join(dataDir, 'backups');

export const databasePath = (dataDir: string) => join(dataDir, 'mymind.db');

/** 時刻をファイル名に使える形にする（2026-09-25T07:53:24.874Z → 20260925T075324Z） */
const stamp = (now: Date) =>
  now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

function snapshotTo(dataDir: string, client: DatabaseSync, prefix: string, now: Date): string {
  const dir = backupsDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = join(dir, `${prefix}-${stamp(now)}.db`);
  const result = writeSnapshot(client, path);
  if (!result.ok) throw new Error(`スナップショットの書き出し先が既にあります: ${path}`);
  // DB と同じ機微データを含むので、本人だけが読めるようにする
  chmodSync(path, 0o600);
  return path;
}

/**
 * マイグレーションの前のスナップショット（NFR-04、#33）。失敗したマイグレーションから戻せるようにする。
 * 書き出したファイルのパスを返す
 */
export function snapshotBeforeMigration(dataDir: string, client: DatabaseSync, now: Date): string {
  return snapshotTo(dataDir, client, 'pre-migration', now);
}

/** 毎日のバックアップの初期値（NFR-04、architecture.md 10章）。業務日の切り替え（5時）の前の、ふつうは使っていない時間 */
export const DAILY_BACKUP_TIME = '03:30';
export const DEFAULT_BACKUP_GENERATIONS = 14;

const DAILY_PREFIX = 'daily';

export type DailyBackupResult =
  | { ok: true; value: { path: string; removed: string[] } }
  | { ok: false; error: { message: string } };

/**
 * 毎日のスナップショット（NFR-04、NFR-23）。書き出したら開いて整合性を確かめ、通らなければ消して失敗にする。
 * 残すのは新しい順に generations 件まで（マイグレーションの前のスナップショットなど、別の種類は数えない）。
 * 保存先が既にあるディレクトリなら権限は変えない（利用者が選んだ、ほかのファイルもある場所かもしれないため）。
 * 作るときは 700 にする（ADR-0009）
 */
export function runDailyBackup(
  client: DatabaseSync,
  dir: string,
  generations: number,
  now: Date,
): DailyBackupResult {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${DAILY_PREFIX}-${stamp(now)}.db`);
    const written = writeSnapshot(client, path);
    if (!written.ok) {
      return { ok: false, error: { message: `書き出し先が既にあります: ${path}` } };
    }
    const reason = inspectBackup(path);
    if (reason !== null) {
      rmSync(path, { force: true });
      return { ok: false, error: { message: `整合性の検査に通りませんでした: ${reason}` } };
    }
    return { ok: true, value: { path, removed: pruneDailyBackups(dir, generations) } };
  } catch (e) {
    // 保存先に書けない（権限、外付けのディスクが外れている）などは、記録して次の日にまた試す
    return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

const dailyPattern = /^daily-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

/** 保存先にある毎日のスナップショットのうち、いちばん新しいものの時刻。なければ null */
export function latestDailyBackupAt(dir: string): Date | null {
  if (!existsSync(dir)) return null;
  let latest: Date | null = null;
  for (const file of readdirSync(dir)) {
    const m = file.match(dailyPattern);
    if (m === null) continue;
    const [, y, mo, d, h, mi, s] = m;
    const at = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

/** 毎日のスナップショットのうち、新しい順に generations 件を残して消す。消したファイルのパスを返す */
function pruneDailyBackups(dir: string, generations: number): string[] {
  // ファイル名の時刻は桁がそろっているので、名前の順が時刻の順になる
  const files = readdirSync(dir)
    .filter((f) => dailyPattern.test(f))
    .sort()
    .reverse();
  const removed = files.slice(generations).map((f) => join(dir, f));
  for (const path of removed) rmSync(path, { force: true });
  return removed;
}

const dailyBackupStatusSchema = z.object({
  at: z.string(),
  result: z.enum(['succeeded', 'failed']),
  error: z.string().nullable(),
});

/** 最後の毎日のバックアップの結果。失敗はファイルが残らないので、状態の画面に出すために別に記録する（NFR-21） */
export type DailyBackupStatus = z.infer<typeof dailyBackupStatusSchema>;

const dailyBackupStatusPath = (dataDir: string) => join(dataDir, 'daily-backup.json');

export function writeDailyBackupStatus(dataDir: string, status: DailyBackupStatus): void {
  writeFileSync(dailyBackupStatusPath(dataDir), JSON.stringify(status), { mode: 0o600 });
}

/** 記録がない、または読めないときは null（読めない記録で状態の画面を止めない） */
export function readDailyBackupStatus(dataDir: string): DailyBackupStatus | null {
  const path = dailyBackupStatusPath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = dailyBackupStatusSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type RestoreError =
  | { kind: 'backup_not_found'; path: string }
  | { kind: 'backup_invalid'; path: string; reason: string }
  | { kind: 'server_running'; pid: number };

/** 戻す前に、バックアップが壊れておらず mymind の DB であることを確かめる */
function inspectBackup(path: string): string | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (e) {
    return (e as Error).message;
  }
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined;
    if (integrity?.integrity_check !== 'ok')
      return `integrity_check: ${integrity?.integrity_check}`;
    const migrations = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get();
    return migrations === undefined
      ? 'mymind の DB ではありません（マイグレーションの記録がない）'
      : null;
  } catch (e) {
    // SQLite のファイルでないときは、開けても最初のクエリで失敗する
    return (e as Error).message;
  } finally {
    db.close();
  }
}

/**
 * バックアップから DB を戻す（NFR-04、#33。手順は docs/operations.md）。
 * サーバーと同じロックを取り、動いているあいだは戻さない。今の DB は before-restore-<時刻>.db に残してから入れ替える。
 * 戻したあとの初回の起動で、足りないマイグレーションが適用される。
 */
export function restoreBackup(
  dataDir: string,
  backupPath: string,
  now: Date,
): { ok: true; value: { savedCurrent: string | null } } | { ok: false; error: RestoreError } {
  if (!existsSync(backupPath))
    return { ok: false, error: { kind: 'backup_not_found', path: backupPath } };
  const reason = inspectBackup(backupPath);
  if (reason !== null)
    return { ok: false, error: { kind: 'backup_invalid', path: backupPath, reason } };

  const lock = acquireLock(dataDir, process.pid);
  if (!lock.ok) return { ok: false, error: { kind: 'server_running', pid: lock.error.pid } };
  try {
    const dbPath = databasePath(dataDir);
    let savedCurrent: string | null = null;
    if (existsSync(dbPath)) {
      const current = new DatabaseSync(dbPath);
      try {
        savedCurrent = snapshotTo(dataDir, current, 'before-restore', now);
      } finally {
        current.close();
      }
    }
    // 古い WAL が残っていると、戻した DB に古い変更が重なるので消す
    for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
    copyFileSync(backupPath, dbPath);
    chmodSync(dbPath, 0o600);
    return { ok: true, value: { savedCurrent } };
  } finally {
    lock.release();
  }
}
