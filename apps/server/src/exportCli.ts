import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createDailyLogRepository,
  createJobRepository,
  createTaskRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { databasePath } from './backups';
import { loadConfig } from './config';
import { collectExportDays, writeExport } from './exportMarkdown';

// 記録を Markdown で書き出すコマンド（pnpm export <ディレクトリ>、FR-R09、docs/operations.md）

/** 未適用のマイグレーションがあるときに、書き出しをやめるための印 */
class PendingMigrations extends Error {}

function main(): number {
  const target = process.argv[2];
  if (target === undefined) {
    console.error('使い方: pnpm export <書き出し先のディレクトリ>');
    return 1;
  }
  const config = loadConfig(process.env);
  if (!config.ok) {
    console.error('環境変数が正しくありません');
    return 1;
  }
  const path = databasePath(config.value.dataDir);
  // 開くと空の DB が作られてしまうので、先に確かめる
  if (!existsSync(path)) {
    console.error(`DB がありません: ${path}`);
    return 1;
  }
  let db: ReturnType<typeof openDatabase>;
  try {
    db = openDatabase({
      path,
      migrationsFolder: config.value.paths.migrations ?? MIGRATIONS_FOLDER,
      // 書き出しでは DB を書き換えない。古い DB は、先にアプリを起動して更新してもらう
      beforeMigrate: () => {
        throw new PendingMigrations();
      },
    });
  } catch (e) {
    if (!(e instanceof PendingMigrations)) throw e;
    console.error(
      'DB が古い形のままです。先にアプリ（サーバー）を起動して更新してから、もう一度実行してください',
    );
    return 1;
  }
  try {
    const days = collectExportDays({
      // 読むだけなので、イベントの ID は作らない
      tasks: createTaskRepository({ db, codec: plainCodec, newEventId: () => '' }),
      logs: createDailyLogRepository({ db, codec: plainCodec }),
      jobs: createJobRepository({ db, codec: plainCodec }),
    });
    const dir = resolve(target);
    const written = writeExport(dir, days);
    console.error(`${written.length} 日分を書き出しました: ${dir}`);
    return 0;
  } finally {
    db.$client.close();
  }
}

process.exitCode = main();
