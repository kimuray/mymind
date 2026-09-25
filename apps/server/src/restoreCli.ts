import { resolve } from 'node:path';
import { databasePath, type RestoreError, restoreBackup } from './backups';
import { loadConfig } from './config';

// バックアップから戻すコマンド（pnpm restore-backup <ファイル>、docs/operations.md）

function describe(error: RestoreError): string {
  switch (error.kind) {
    case 'backup_not_found':
      return `バックアップが見つかりません: ${error.path}`;
    case 'backup_invalid':
      return `バックアップを使えません（${error.reason}）: ${error.path}`;
    case 'server_running':
      return `サーバーが動いています（PID ${error.pid}）。止めてから実行してください`;
  }
}

function main(): number {
  const source = process.argv[2];
  if (source === undefined) {
    console.error('使い方: pnpm restore-backup <バックアップのファイル>');
    return 1;
  }
  const config = loadConfig(process.env);
  if (!config.ok) {
    console.error('環境変数が正しくありません');
    return 1;
  }
  const { dataDir } = config.value;
  const result = restoreBackup(dataDir, resolve(source), new Date());
  if (!result.ok) {
    console.error(describe(result.error));
    return 1;
  }
  if (result.value.savedCurrent !== null) {
    console.error(`今の DB を残しました: ${result.value.savedCurrent}`);
  }
  console.error(`戻しました: ${resolve(source)} → ${databasePath(dataDir)}`);
  console.error('サーバーを起動すると、足りないマイグレーションがあれば適用されます');
  return 0;
}

process.exitCode = main();
