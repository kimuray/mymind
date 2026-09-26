import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AgentRunner,
  createFakeAgentRunner,
  detectAgent,
  readPromptVersion,
  unavailableRunner,
} from '@mymind/agent';
import {
  createJobRepository,
  createSettingsRepository,
  createTaskRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { createAgentLog } from './agentLog';
import { createApi } from './api';
import { createApp } from './app';
import { backupsDir, databasePath, snapshotBeforeMigration } from './backups';
import { type ConfigError, loadConfig } from './config';
import { acquireLock, ensureDataDir, issueSessionToken } from './dataDir';
import { createEventBus } from './events';
import { createJobRunner } from './jobRunner';
import { listen } from './listen';
import { createLogger } from './logger';
import { createUlidGenerator } from './ulid';
import { createWebRoutes } from './web';

// 画面の本番ビルド（apps/web の vite build の出力）
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

// 日次 FB のプロンプト（architecture.md 7.5）
const DAILY_PROMPT = fileURLToPath(new URL('../../../prompts/daily-feedback.md', import.meta.url));
// エージェントの待ち時間の上限（architecture.md 7.4 の初期値）
const AGENT_TIMEOUT_MS = 120_000;

// 業務日の切り替え（FR-D01）。設定画面ができるまでは初期値を使う
const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };

// サーバーのロガーを用意するまでは、起動時の失敗を console.error で表示する

function describeConfigError(error: ConfigError): string {
  switch (error.kind) {
    case 'invalid_env':
      return `環境変数が正しくありません：\n  ${error.issues.join('\n  ')}`;
    case 'all_interfaces_outside_container':
      return 'MYMIND_HOST=0.0.0.0 はコンテナの中（MYMIND_IN_CONTAINER=1）でだけ使えます';
  }
}

async function main(): Promise<number> {
  const config = loadConfig(process.env);
  if (!config.ok) {
    console.error(describeConfigError(config.error));
    return 1;
  }
  const { dataDir, host, port, devPorts, agent } = config.value;

  ensureDataDir(dataDir);
  const lock = acquireLock(dataDir, process.pid);
  if (!lock.ok) {
    console.error(
      `同じデータディレクトリ（${dataDir}）を使うサーバーが既に動いています（PID ${lock.error.pid}）`,
    );
    return 1;
  }

  const sessionToken = issueSessionToken(dataDir);
  const db = openDatabase({
    path: databasePath(dataDir),
    migrationsFolder: MIGRATIONS_FOLDER,
    // 未適用のマイグレーションがあれば、適用の前にスナップショットを取る（NFR-04。戻し方は docs/operations.md）
    beforeMigrate: ({ client, pending }) => {
      const path = snapshotBeforeMigration(dataDir, client, new Date());
      process.stdout.write(
        `マイグレーション（${pending.join(', ')}）の前にバックアップしました: ${path}\n`,
      );
    },
  });
  const newId = createUlidGenerator(() => Date.now());
  const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
  const jobs = createJobRepository({ db, codec: plainCodec });
  const events = createEventBus();
  const promptText = readFileSync(DAILY_PROMPT, 'utf8');
  const runner: AgentRunner =
    agent.name === 'fake'
      ? createFakeAgentRunner({ mode: agent.fakeMode, delayMs: agent.fakeDelayMs })
      : // 実物のエージェントのアダプタは、起動方法のスパイク（#10、ADR-0005）の後で作る
        unavailableRunner(
          agent.name,
          `${agent.name} のアダプタはまだ使えません（MYMIND_AGENT=fake で偽のアダプタを使えます）`,
        );
  const logger = createLogger();
  // エージェントの入出力の全文は、データディレクトリの中にだけ残し、30 日で消す（ADR-0009）
  const agentLog = createAgentLog(join(dataDir, 'logs/agent'));
  agentLog.prune(new Date().toISOString().slice(0, 10));
  const jobRunner = createJobRunner({
    agentLog,
    logger,
    jobs,
    tasks,
    runner,
    events,
    prompt: { text: promptText, version: readPromptVersion(promptText) ?? 'unknown' },
    now: () => new Date(),
    newId,
    timeoutMs: AGENT_TIMEOUT_MS,
  });
  jobRunner.start();
  const api = createApi({
    tasks,
    now: () => new Date(),
    dayOptions: DAY_OPTIONS,
    newId,
    jobs: { runner: jobRunner, jobs, events },
    health: {
      checkDatabase: () => {
        try {
          db.$client.prepare('SELECT 1').get();
          return { ok: true };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      },
      databaseFiles: ['', '-wal', '-shm'].map((suffix) => databasePath(dataDir) + suffix),
      backupsDir: backupsDir(dataDir),
      jobs,
      agentStatus: () => detectAgent(agent.name),
    },
    settings: createSettingsRepository({ db }),
  });
  const web = createWebRoutes({ distDir: WEB_DIST, sessionToken });
  const app = createApp({ ports: [port, ...devPorts], sessionToken }, api, web);
  const server = await listen(app, host, port);
  if (!server.ok) {
    db.$client.close();
    lock.release();
    console.error(
      `ポート ${port} は使用中です。使っているプロセスを止めるか、MYMIND_PORT で別のポートを指定してください`,
    );
    return 1;
  }

  const shutdown = async () => {
    await server.value.close();
    db.$client.close();
    lock.release();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // 標準出力は起動の確認に使う（console.log はロガーに置き換えるまで使わない）
  process.stdout.write(`mymind を http://127.0.0.1:${port} で起動しました\n`);
  return 0;
}

const code = await main();
if (code !== 0) process.exit(code);
