import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { MIGRATIONS_FOLDER, openDatabase } from '@mymind/db';
import { databasePath } from './backups';
import { acquireLock, ensureDataDir } from './dataDir';
import { checkSeedTarget, type SeedTargetError, seedDatabase } from './seed';

// 開発用のシードデータを入れるコマンド（MYMIND_DATA_DIR=./.data pnpm seed、issue 017）

// 業務日の切り替え（FR-D01）。サーバーの初期値と同じ
const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };

function describe(error: SeedTargetError): string {
  switch (error.kind) {
    case 'data_dir_missing':
      return '使い方: MYMIND_DATA_DIR=./.data pnpm seed（実データを守るため、データディレクトリの指定が必要です）';
    case 'real_data_dir':
      return `実データのディレクトリ（${error.dataDir}）には入れられません。./.data などを指定してください`;
    case 'database_exists':
      return `DB が既にあります: ${error.path}。上書きしないので、空のデータディレクトリを指定するか、DB を消してから実行してください`;
  }
}

async function main(): Promise<number> {
  const target = checkSeedTarget(process.env, homedir(), existsSync);
  if (!target.ok) {
    console.error(describe(target.error));
    return 1;
  }
  const { dataDir } = target;
  ensureDataDir(dataDir);
  const lock = acquireLock(dataDir, process.pid);
  if (!lock.ok) {
    console.error(`同じデータディレクトリを使うサーバーが動いています（PID ${lock.error.pid}）`);
    return 1;
  }
  try {
    const db = openDatabase({ path: databasePath(dataDir), migrationsFolder: MIGRATIONS_FOLDER });
    const { from, to } = await seedDatabase({ db, now: new Date(), dayOptions: DAY_OPTIONS });
    db.$client.close();
    console.error(`${from} から ${to} までのシードを入れました: ${databasePath(dataDir)}`);
    return 0;
  } finally {
    lock.release();
  }
}

process.exitCode = await main();
