import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { databasePath, restoreBackup, snapshotBeforeMigration } from './backups';
import { acquireLock } from './dataDir';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'mymind-backup-'));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe('NFR-04 マイグレーションの前のスナップショット', () => {
  it('backups/ に時刻の付いた名前で、本人だけが読めるファイルとして書き出す', () => {
    const client = new DatabaseSync(':memory:');
    client.exec("CREATE TABLE t(x); INSERT INTO t VALUES ('残す')");
    const path = snapshotBeforeMigration(dataDir, client, new Date('2026-09-25T07:53:24.874Z'));
    expect(path).toBe(join(dataDir, 'backups', 'pre-migration-20260925T075324Z.db'));
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, 'backups')).mode & 0o777).toBe(0o700);
    const copy = new DatabaseSync(path, { readOnly: true });
    expect(copy.prepare('SELECT x FROM t').all()).toEqual([{ x: '残す' }]);
    copy.close();
  });
});

describe('NFR-04 バックアップから戻す', () => {
  const NOW = new Date('2026-09-25T08:00:00.000Z');
  /** mymind の DB に見えるファイル（マイグレーションの記録と、メモの行を持つ）を作る */
  const createDb = (path: string, note: string) => {
    const db = new DatabaseSync(path);
    db.exec(
      'CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE notes(x)',
    );
    db.prepare('INSERT INTO notes VALUES (?)').run(note);
    db.close();
  };
  const readNotes = (path: string) => {
    const db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare('SELECT x FROM notes').all();
    db.close();
    return rows;
  };

  it('今の DB を before-restore として残してから、バックアップの内容に入れ替える', () => {
    const backup = join(dataDir, 'backup.db');
    createDb(backup, '戻したい内容');
    createDb(databasePath(dataDir), '今の内容');

    const result = restoreBackup(dataDir, backup, NOW);

    const saved = join(dataDir, 'backups', 'before-restore-20260925T080000Z.db');
    expect(result).toEqual({ ok: true, value: { savedCurrent: saved } });
    expect(readNotes(databasePath(dataDir))).toEqual([{ x: '戻したい内容' }]);
    expect(readNotes(saved)).toEqual([{ x: '今の内容' }]);
    expect(statSync(databasePath(dataDir)).mode & 0o777).toBe(0o600);
    expect(statSync(saved).mode & 0o777).toBe(0o600);
  });

  it('DB がまだなければ、残さずにバックアップを置く', () => {
    const backup = join(dataDir, 'backup.db');
    createDb(backup, '戻したい内容');
    expect(restoreBackup(dataDir, backup, NOW)).toEqual({
      ok: true,
      value: { savedCurrent: null },
    });
    expect(readNotes(databasePath(dataDir))).toEqual([{ x: '戻したい内容' }]);
  });

  it('サーバーが動いている（ロックがある）あいだは戻さない', () => {
    const backup = join(dataDir, 'backup.db');
    createDb(backup, '戻したい内容');
    createDb(databasePath(dataDir), '今の内容');
    // 生きている別のプロセス（テストの親プロセス）がロックを持っている状態
    const lock = acquireLock(dataDir, process.ppid);
    expect(lock.ok).toBe(true);

    expect(restoreBackup(dataDir, backup, NOW)).toEqual({
      ok: false,
      error: { kind: 'server_running', pid: process.ppid },
    });
    expect(readNotes(databasePath(dataDir))).toEqual([{ x: '今の内容' }]);
  });

  it('バックアップがなければ失敗を返す', () => {
    const missing = join(dataDir, 'missing.db');
    expect(restoreBackup(dataDir, missing, NOW)).toEqual({
      ok: false,
      error: { kind: 'backup_not_found', path: missing },
    });
  });

  it('SQLite のファイルでなければ、今の DB に触れずに失敗を返す', () => {
    const broken = join(dataDir, 'broken.db');
    writeFileSync(broken, 'これは DB ではない');
    createDb(databasePath(dataDir), '今の内容');
    expect(restoreBackup(dataDir, broken, NOW)).toMatchObject({
      ok: false,
      error: { kind: 'backup_invalid', path: broken },
    });
    expect(readNotes(databasePath(dataDir))).toEqual([{ x: '今の内容' }]);
  });

  it('マイグレーションの記録がない DB は、mymind の DB ではないとして戻さない', () => {
    const other = join(dataDir, 'other.db');
    const db = new DatabaseSync(other);
    db.exec('CREATE TABLE t(x)');
    db.close();
    expect(restoreBackup(dataDir, other, NOW)).toMatchObject({
      ok: false,
      error: { kind: 'backup_invalid' },
    });
  });
});
