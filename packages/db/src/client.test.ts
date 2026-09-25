import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { itemEvents, items } from '../fixtures/migration-check/schema';
import { type Database, openDatabase } from './client';
import { writeSnapshot } from './snapshot';

const migrationsFolder = fileURLToPath(
  new URL('../fixtures/migration-check/migrations', import.meta.url),
);

let dir: string;
let opened: Database[];
const open = (path: string) => {
  const db = openDatabase({ path, migrationsFolder });
  opened.push(db);
  return db;
};
const pragma = (db: Database, name: string) =>
  db.$client.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mymind-db-'));
  opened = [];
});
afterEach(() => {
  for (const db of opened) if (db.$client.isOpen) db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ADR-0006 node:sqlite と Drizzle のマイグレーション', () => {
  it('drizzle-kit generate が出力した SQL を開くときに適用する', async () => {
    const db = open(':memory:');
    await db.insert(items).values({ id: 'a', title: 'タスク', status: 'todo' });
    expect(await db.select().from(items)).toEqual([{ id: 'a', title: 'タスク', status: 'todo' }]);
  });

  it('同じファイルを開き直しても適用済みのマイグレーションを繰り返さない', async () => {
    const path = join(dir, 'mymind.db');
    const first = open(path);
    await first.insert(items).values({ id: 'a', title: 'タスク', status: 'todo' });
    first.$client.close();

    const second = open(path);
    expect(await second.select().from(items)).toHaveLength(1);
  });
});

describe('ADR-0006 接続の設定', () => {
  it('ファイルの DB は WAL で開く', () => {
    expect(pragma(open(join(dir, 'mymind.db')), 'journal_mode')).toEqual({ journal_mode: 'wal' });
  });

  it('書き込みのロックを既定で5秒待つ', () => {
    expect(pragma(open(join(dir, 'mymind.db')), 'busy_timeout')).toEqual({ timeout: 5000 });
  });

  it('外部キーの制約を有効にする', async () => {
    const db = open(':memory:');
    // Drizzle は SQLite のエラーを "Failed query" で包み、元のエラーを cause に入れる
    await expect(
      db.insert(itemEvents).values({ itemId: 'missing', kind: 'created' }),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/FOREIGN KEY/) } });
  });

  it('別の接続が書き込み中なら、待ったあとでロックの失敗を返す', () => {
    const path = join(dir, 'mymind.db');
    const writer = open(path);
    const other = openDatabase({ path, migrationsFolder, busyTimeoutMs: 50 });
    opened.push(other);
    writer.$client.exec('BEGIN IMMEDIATE');
    expect(() => other.$client.exec('BEGIN IMMEDIATE')).toThrow(/database is locked/);
    writer.$client.exec('COMMIT');
  });
});

// node:sqlite のドライバは同期で動くため、トランザクションのコールバックは同期関数にし、
// 中のクエリは await ではなく .run() / .all() / .get() で実行する（ADR-0006）
describe('ADR-0004 トランザクション', () => {
  it('途中で失敗したら、それまでの書き込みを取り消す', () => {
    const db = open(':memory:');
    expect(() =>
      db.transaction((tx) => {
        tx.insert(items).values({ id: 'a', title: 'タスク', status: 'doing' }).run();
        tx.insert(itemEvents).values({ itemId: 'a', kind: 'started' }).run();
        throw new Error('保存の途中で失敗');
      }),
    ).toThrow('保存の途中で失敗');
    expect(db.select().from(items).all()).toEqual([]);
    expect(db.select().from(itemEvents).all()).toEqual([]);
  });

  it('イベントの追加とステータスの更新を一緒に確定する', () => {
    const db = open(':memory:');
    db.insert(items).values({ id: 'a', title: 'タスク', status: 'todo' }).run();
    db.transaction((tx) => {
      tx.insert(itemEvents).values({ itemId: 'a', kind: 'started' }).run();
      tx.update(items).set({ status: 'doing' }).where(eq(items.id, 'a')).run();
    });
    expect(db.select({ status: items.status }).from(items).all()).toEqual([{ status: 'doing' }]);
    expect(db.select({ kind: itemEvents.kind }).from(itemEvents).all()).toEqual([
      { kind: 'started' },
    ]);
  });

  it('非同期のコールバックは最初の await の前にコミットされ、取り消せないので型で禁止されている', async () => {
    const db = open(':memory:');
    // この誤用を型が検出しなくなったら、@ts-expect-error が型チェックを失敗させて気づける
    // @ts-expect-error Sync drivers can't use async functions in transactions!
    const pending: Promise<void> = db.transaction(async (tx) => {
      await tx.insert(items).values({ id: 'a', title: 'タスク', status: 'doing' });
      throw new Error('保存の途中で失敗');
    });
    await expect(pending).rejects.toThrow('保存の途中で失敗');
    expect(db.select({ id: items.id }).from(items).all()).toEqual([{ id: 'a' }]);
  });
});

describe('NFR-04 スナップショット', () => {
  it('VACUUM INTO で別のファイルに書き出し、そのファイルを開いて読める', async () => {
    const db = open(join(dir, 'mymind.db'));
    await db.insert(items).values({ id: 'a', title: 'タスク', status: 'todo' });
    const destination = join(dir, 'snapshot.db');

    expect(writeSnapshot(db.$client, destination)).toEqual({ ok: true });

    const snapshot = new DatabaseSync(destination, { readOnly: true });
    expect(snapshot.prepare('SELECT id FROM items').all()).toEqual([{ id: 'a' }]);
    snapshot.close();
  });

  it('書き出し先が既にあれば、上書きせずに失敗を返す', () => {
    const db = open(join(dir, 'mymind.db'));
    const destination = join(dir, 'snapshot.db');
    writeSnapshot(db.$client, destination);

    expect(writeSnapshot(db.$client, destination)).toEqual({
      ok: false,
      error: { kind: 'destination_exists', path: destination },
    });
  });
});

describe('NFR-16 ファイルのパーミッション', () => {
  const mode = (path: string) => statSync(path).mode & 0o777;

  it('DB と WAL のファイルを、本人だけが読み書きできるようにする', () => {
    const path = join(dir, 'mymind.db');
    open(path);
    expect(mode(path)).toBe(0o600);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(path + suffix)) expect(mode(path + suffix)).toBe(0o600);
    }
  });

  it('スナップショットも本人だけが読めるようにする', () => {
    const db = open(join(dir, 'mymind.db'));
    const destination = join(dir, 'snapshot.db');
    writeSnapshot(db.$client, destination);
    expect(mode(destination)).toBe(0o600);
  });
});
