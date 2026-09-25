import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeSnapshot } from '@mymind/db';
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
