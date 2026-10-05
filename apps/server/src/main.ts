import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentPath,
  createClaudeRunner,
  createCodexRunner,
  createFakeAgentRunner,
  detectAgent,
  readLoginShellPath,
} from '@mymind/agent';
import {
  createDailyLogRepository,
  createJobRepository,
  createNotificationRepository,
  createSettingsRepository,
  createTaskRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { toBusinessDay } from '@mymind/domain';
import { createAgentLog } from './agentLog';
import { type AgentRunners, initialAgentChoice } from './agents';
import { createApi } from './api';
import { createApp } from './app';
import {
  backupsDir,
  databasePath,
  readDailyBackupStatus,
  snapshotBeforeMigration,
} from './backups';
import { type ConfigError, loadConfig } from './config';
import { createDailyBackupJob, dailyBackupDir } from './dailyBackup';
import { acquireLock, ensureDataDir, issueSessionToken } from './dataDir';
import { createDesktopNotifier, desktopParentPort } from './desktopBridge';
import { createEventBus } from './events';
import { createJobRunner } from './jobRunner';
import { listen } from './listen';
import { createLogger } from './logger';
import {
  activeChannel,
  createBannerChannel,
  createBrowserChannel,
  createBrowserPermissionState,
  createDesktopChannel,
  createMacosChannel,
  createNotificationRouter,
  createPendingNotifications,
  findExecutable,
  NOTIFIER_COMMAND,
} from './notificationAdapters';
import { createNotificationJobs } from './notifications';
import { loadDailyPrompt, loadMonthlyPrompt } from './prompts';
import { createScheduler } from './scheduler';
import { createServerLogFile } from './serverLog';
import { createSettingsReader, notificationScheduleOf } from './settingsApi';
import { createUlidGenerator } from './ulid';
import { createDevRedirect, createWebRoutes } from './web';

// 画面の本番ビルド（apps/web の vite build の出力）
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

// 日次 FB のプロンプト（architecture.md 7.5）
// エージェントの待ち時間の上限（architecture.md 7.4 の初期値）

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
  const { dataDir, host, port, devPorts, agent, paths, desktop } = config.value;
  const parent = desktop ? desktopParentPort() : null;
  /** 起動できなかった理由を表示する。デスクトップアプリには、起動し直しても直らないことを知らせる */
  const fail = (reason: string): number => {
    console.error(reason);
    parent?.postMessage({ type: 'fatal', reason });
    return 1;
  };
  if (desktop) {
    // Finder や Dock から開いたアプリの PATH には、エージェントの CLI の場所が入っていない（ADR-0016）
    process.env['PATH'] = buildAgentPath({
      current: process.env['PATH'],
      loginShell: await readLoginShellPath(process.env['SHELL']),
      home: homedir(),
    });
  }

  ensureDataDir(dataDir);
  const lock = acquireLock(dataDir, process.pid);
  if (!lock.ok) {
    return fail(
      `同じデータディレクトリ（${dataDir}）を使うサーバーが既に動いています（PID ${lock.error.pid}）`,
    );
  }

  const sessionToken = issueSessionToken(dataDir);
  const db = openDatabase({
    path: databasePath(dataDir),
    migrationsFolder: paths.migrations ?? MIGRATIONS_FOLDER,
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
  const logs = createDailyLogRepository({ db, codec: plainCodec });
  const events = createEventBus();
  const prompt = paths.prompts === null ? loadDailyPrompt() : loadDailyPrompt(paths.prompts);
  const monthlyPrompt =
    paths.prompts === null ? loadMonthlyPrompt() : loadMonthlyPrompt(paths.prompts);
  // 実物のエージェントは、空の作業ディレクトリで、ツールを止めて起動する（ADR-0003、ADR-0005）
  // モデルの指定は CLI ごとに名前が違うので、MYMIND_AGENT で選んだエージェントにだけ渡す
  const modelFor = (name: string) =>
    agent.name === name && agent.model !== null ? agent.model : undefined;
  const fake = createFakeAgentRunner({ mode: agent.fakeMode, delayMs: agent.fakeDelayMs });
  const runners: AgentRunners =
    agent.name === 'fake'
      ? { claude: fake, codex: fake }
      : {
          claude: createClaudeRunner({ model: modelFor('claude') }),
          codex: createCodexRunner({ model: modelFor('codex') }),
        };
  const settings = createSettingsRepository({ db });
  // 設定で既定のエージェントを選んでいなければ、MYMIND_AGENT のエージェントを使う（FR-A07）
  const settingsDefaults = { defaultAgent: initialAgentChoice(agent.name) };
  const currentSettings = createSettingsReader(settings, settingsDefaults);
  // サーバーのログは、データディレクトリに日付ごとのファイルで残し、14日で消す（NFR-24）。
  // 常駐すると標準エラーは見ないので、開発のとき（Vite と一緒に動かすとき）だけ標準エラーにも出す
  const serverLog = createServerLogFile({
    dir: join(dataDir, 'logs/server'),
    timeZone: DAY_OPTIONS.timeZone,
  });
  const isDev = devPorts.length > 0;
  const logger = createLogger({
    write: (line) => {
      serverLog.write(line);
      if (isDev) process.stderr.write(`${line}\n`);
    },
  });
  // エージェントの入出力の全文は、データディレクトリの中にだけ残し、30 日で消す（ADR-0009）
  const agentLog = createAgentLog(join(dataDir, 'logs/agent'));
  agentLog.prune(new Date().toISOString().slice(0, 10));
  const jobRunner = createJobRunner({
    agentLog,
    logger,
    jobs,
    tasks,
    logs,
    runners,
    defaultAgent: () => currentSettings().defaultAgent,
    events,
    prompt,
    monthlyPrompt,
    now: () => new Date(),
    today: () => toBusinessDay(new Date(), DAY_OPTIONS),
    newId,
    timeoutMs: agent.timeoutMs,
  });
  jobRunner.start();
  // 定期処理（毎日のバックアップ、通知）の土台。予定はそれぞれの機能が add で加える（NFR-19）
  const scheduler = createScheduler({
    now: () => new Date(),
    timeZone: DAY_OPTIONS.timeZone,
    logger,
  });
  const dailyBackup = createDailyBackupJob({
    client: db.$client,
    dataDir,
    settings: currentSettings,
    now: () => new Date(),
    logger,
  });
  scheduler.add(dailyBackup);
  // 通知を出す手段（FR-N05、architecture.md 9.2）。macOS の通知のコマンド、ブラウザの通知、画面のバナーの順に使う。
  // コマンドは後から入れても再起動せずに使えるよう、通知のたびに探す
  const pendingNotifications = createPendingNotifications(() => new Date());
  const browserPermission = createBrowserPermissionState();
  const notifierCommand = () => findExecutable(NOTIFIER_COMMAND, process.env['PATH']);
  // デスクトップアプリでは OS の通知だけを使い、出せなかったときは画面のバナーに回す（ADR-0015）
  const notificationChannels =
    parent === null
      ? [
          createMacosChannel({ command: notifierCommand, baseUrl: `http://127.0.0.1:${port}` }),
          createBrowserChannel({ events, permission: browserPermission }),
          createBannerChannel({ pending: pendingNotifications, events }),
        ]
      : [
          createDesktopChannel(createDesktopNotifier(parent)),
          createBannerChannel({ pending: pendingNotifications, events }),
        ];
  // 朝・夜・棚卸しの通知（FR-N01〜N03）。オン・オフと時刻は設定で変えられ、変えたら組み直す（FR-N04）
  for (const job of createNotificationJobs({
    tasks,
    logs,
    jobs,
    sent: createNotificationRepository({ db }),
    adapter: createNotificationRouter(notificationChannels, logger),
    reviewAfterDays: () => currentSettings().reviewAfterDays,
    schedule: (kind) => notificationScheduleOf(currentSettings(), kind),
    dayOptions: DAY_OPTIONS,
    now: () => new Date(),
    logger,
  })) {
    scheduler.add(job);
  }
  scheduler.start();
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
      backupsDirs: () => [
        backupsDir(dataDir),
        dailyBackupDir(dataDir, currentSettings().backupDir),
      ],
      dailyBackup: () => readDailyBackupStatus(dataDir),
      jobs,
      // 状態の表示は、依頼で既定に使うエージェントを確かめる
      agentStatus: () =>
        detectAgent(agent.name === 'fake' ? 'fake' : currentSettings().defaultAgent),
      notificationStatus: () => ({
        channel: activeChannel(notificationChannels),
        command: notifierCommand(),
        browser: browserPermission.get(),
      }),
    },
    settings,
    settingsDefaults,
    settingsRuntime: { fakeAgent: agent.name === 'fake', defaultBackupDir: backupsDir(dataDir) },
    logs,
    notifications: { pending: pendingNotifications, permission: browserPermission, events },
    onSettingsChange: () => scheduler.reschedule(),
  });
  // 開発時は Vite が画面を配信する。古い本番ビルドを出さないよう、画面の URL は Vite へ移す（#97）
  const vitePort = devPorts[0];
  const web =
    vitePort === undefined
      ? createWebRoutes({ distDir: paths.webDist ?? WEB_DIST, sessionToken })
      : createDevRedirect(vitePort);
  const app = createApp({ ports: [port, ...devPorts], sessionToken }, api, web);
  const server = await listen(app, host, port);
  if (!server.ok) {
    scheduler.stop();
    db.$client.close();
    lock.release();
    return fail(
      `ポート ${port} は使用中です。使っているプロセスを止めるか、MYMIND_PORT で別のポートを指定してください`,
    );
  }

  const shutdown = async () => {
    scheduler.stop();
    await server.value.close();
    db.$client.close();
    lock.release();
    process.exit(0);
  };
  // 止まっていた間に毎日のバックアップの時刻を過ぎていれば、次の 3:30 を待たずに取る（NFR-23）
  dailyBackup.runIfStale();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // 標準出力は起動の確認に使う（console.log はロガーに置き換えるまで使わない）
  process.stdout.write(`mymind を http://127.0.0.1:${port} で起動しました\n`);
  // デスクトップアプリは、この知らせを受けてからウィンドウを開く（ADR-0015）
  parent?.postMessage({ type: 'ready', url: `http://127.0.0.1:${port}` });
  return 0;
}

const code = await main();
if (code !== 0) process.exit(code);
