import { chmodSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

/**
 * ドライバは同期で動くので、db.transaction() のコールバックは同期関数にし、
 * 中のクエリは .run() / .all() / .get() で実行する。await すると取り消せなくなる（ADR-0011）
 */
export type Database = NodeSQLiteDatabase & { $client: DatabaseSync };

/** アプリのマイグレーション（drizzle-kit generate の出力先） */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export type OpenDatabaseOptions = {
  /** DB ファイルのパス。テストでは ':memory:' を渡す */
  path: string;
  /** drizzle-kit generate が出力したマイグレーションのディレクトリ */
  migrationsFolder: string;
  /** 別の接続が書き込み中のときに待つ時間（ミリ秒） */
  busyTimeoutMs?: number;
};

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * DB を開き、接続ごとの PRAGMA を設定してからマイグレーションを適用する（ADR-0006）。
 * 開けない・適用できない状態からは復旧できないので、失敗は例外のまま起動を止める。
 */
export function openDatabase(options: OpenDatabaseOptions): Database {
  const client = new DatabaseSync(options.path, {
    timeout: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
  });
  // WAL にすると、画面の読み込みとジョブの書き込みが互いを待たない。インメモリ DB では memory のまま
  client.exec('PRAGMA journal_mode = WAL');
  client.exec('PRAGMA foreign_keys = ON');
  // WAL では NORMAL でもコミット済みのデータは電源断以外で失われない
  client.exec('PRAGMA synchronous = NORMAL');

  const db = drizzle({ client });
  migrate(db, { migrationsFolder: options.migrationsFolder });
  // WAL の -wal と -shm は最初の書き込み（マイグレーション）で作られるので、その後で直す
  restrictFileMode(options.path);
  return db;
}

/**
 * DB のファイルを本人だけが読み書きできるようにする（ADR-0009：DB は 600）。
 * WAL の -wal と -shm も同じ内容を含むので、合わせて直す。
 */
function restrictFileMode(path: string) {
  if (path === ':memory:' || path.startsWith('file:')) return;
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}
