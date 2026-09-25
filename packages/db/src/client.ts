import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
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
  /**
   * マイグレーションの直前に呼ぶ。まだ適用していないマイグレーションの名前を渡す（NFR-04：適用の前にスナップショットを取るため）。
   * 新しく作った DB（まだ何もない）では呼ばない
   */
  beforeMigrate?: (context: { client: DatabaseSync; pending: string[] }) => void;
};

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * DB を開き、接続ごとの PRAGMA を設定してからマイグレーションを適用する（ADR-0006）。
 * 開けない・適用できない状態からは復旧できないので、失敗は例外のまま起動を止める。
 */
/** Drizzle が適用済みのマイグレーションを記録する表 */
const MIGRATIONS_TABLE = '__drizzle_migrations';

function hasAppliedMigrations(client: DatabaseSync): boolean {
  const table = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  return table !== undefined;
}

/** まだ適用していないマイグレーションの名前（マイグレーションのフォルダの名前） */
export function pendingMigrations(client: DatabaseSync, migrationsFolder: string): string[] {
  const applied = hasAppliedMigrations(client)
    ? new Set(
        client
          .prepare(`SELECT name FROM "${MIGRATIONS_TABLE}"`)
          .all()
          .map((r) => String(r['name'])),
      )
    : new Set<string>();
  return readMigrationFiles({ migrationsFolder })
    .map((m) => m.name)
    .filter((name) => !applied.has(name));
}

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
  const pending = pendingMigrations(client, options.migrationsFolder);
  if (options.beforeMigrate !== undefined && pending.length > 0 && hasAppliedMigrations(client)) {
    options.beforeMigrate({ client, pending });
  }
  migrate(db, { migrationsFolder: options.migrationsFolder });
  return db;
}
