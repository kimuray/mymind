import { createFakeAgentRunner } from '@mymind/agent';
import {
  createDailyLogRepository,
  createJobRepository,
  createNotificationRepository,
  createSettingsRepository,
  createTaskRepository,
  type Feedback,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import type { Notification } from '@mymind/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api';
import { createApp } from './app';
import { createEventBus } from './events';
import { createJobRunner } from './jobRunner';
import type { Logger } from './logger';
import {
  createNotificationJobs,
  type NotificationAdapter,
  type NotificationDeps,
  sendNotification,
} from './notifications';
import { createScheduler, type TimerHandle } from './scheduler';
import { TOKEN_HEADER } from './security';

const PORT = 4820;
const TOKEN = 'token';
const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };
/** 日本時間の日時を UTC の Date にする */
const jst = (day: string, time: string) => new Date(`${day}T${time}:00+09:00`);

// 2026-10-04 は日曜
const SAT = '2026-10-03';
const SUN = '2026-10-04';
const MON = '2026-10-05';

let now: Date;
let app: ReturnType<typeof createApp>;
let deps: NotificationDeps;
let sent: Notification[];
let adapterResult: { ok: true } | { ok: false; message: string };
let previousFeedback: Feedback | undefined;
let reviewAfterDays: number;

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

beforeEach(() => {
  now = jst(SAT, '10:00');
  sent = [];
  adapterResult = { ok: true };
  previousFeedback = undefined;
  reviewAfterDays = 30;
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  let seq = 0;
  const newId = () => `id${String(++seq).padStart(5, '0')}`;
  const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
  const jobs = createJobRepository({ db, codec: plainCodec });
  const logs = createDailyLogRepository({ db, codec: plainCodec });
  const events = createEventBus();
  const runner = createJobRunner({
    jobs,
    tasks,
    logs,
    runners: { claude: createFakeAgentRunner(), codex: createFakeAgentRunner() },
    defaultAgent: () => 'claude',
    events,
    prompt: { text: 'プロンプト', version: '0.1.0' },
    monthlyPrompt: { text: '月次のプロンプト', version: '0.1.0' },
    now: () => now,
    today: () => SAT,
    newId,
    timeoutMs: 1000,
  });
  const api = createApi({
    tasks,
    now: () => now,
    dayOptions: DAY_OPTIONS,
    newId,
    jobs: { runner, jobs, events },
    health: {
      checkDatabase: () => ({ ok: true }),
      databaseFiles: [],
      backupsDir: '/nonexistent',
      jobs,
      agentStatus: async () => ({ name: 'fake', usable: true, executable: null, message: null }),
    },
    settings: createSettingsRepository({ db }),
    logs,
  });
  app = createApp({ ports: [PORT], sessionToken: TOKEN }, api);
  const adapter: NotificationAdapter = {
    notify: async (n) => {
      if (adapterResult.ok) sent.push(n);
      return adapterResult;
    },
  };
  deps = {
    tasks,
    logs,
    jobs: { latestDailyFeedbackBefore: () => previousFeedback },
    sent: createNotificationRepository({ db }),
    adapter,
    reviewAfterDays: () => reviewAfterDays,
    dayOptions: DAY_OPTIONS,
    now: () => now,
    logger: silent,
  };
});

const headers = {
  Host: `127.0.0.1:${PORT}`,
  'Sec-Fetch-Site': 'same-origin',
  Origin: `http://127.0.0.1:${PORT}`,
  [TOKEN_HEADER]: TOKEN,
  'Content-Type': 'application/json',
};
const send = async (method: string, path: string, body: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers, body: JSON.stringify(body) });
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ task: { id: string; version: number } }>;
};

/** 今の業務日にタスクを足す。planFor を省くとバックログ */
async function addTask(day: string, title: string, planFor?: 'today') {
  const body = await send('POST', '/tasks', {
    title,
    expectedDay: day,
    ...(planFor === undefined ? {} : { planFor }),
  });
  return body.task;
}

async function transition(day: string, task: { id: string; version: number }, to: string) {
  return (
    await send('POST', `/tasks/${task.id}/transition`, {
      to,
      expectedVersion: task.version,
      expectedDay: day,
    })
  ).task;
}

/** 未着手のタスクを、着手してから完了にする（未着手から完了へは直接変えられない） */
const complete = async (day: string, task: { id: string; version: number }) =>
  transition(day, await transition(day, task, 'doing'), 'done');

const feedbackOf = (period: string): Feedback => ({
  id: 'fb1',
  scope: 'daily',
  period,
  jobId: null,
  content: {},
  agent: 'fake',
  promptVersion: '0.1.0',
  isPartial: false,
  createdAt: jst(period, '22:00').toISOString(),
});

describe('FR-N01 朝の通知（結合）', () => {
  beforeEach(async () => {
    // 土曜に3件を計画し、1件だけ完了する。日曜の朝は2件が持ち越し候補
    const first = await addTask(SAT, '企画書', 'today');
    await addTask(SAT, '見積もり', 'today');
    await addTask(SAT, '請求書', 'today');
    await complete(SAT, first);
    now = jst(SUN, '08:30');
  });

  it('計画が未確定なら、昨日の FB と持ち越しの件数を書いて送る', async () => {
    previousFeedback = feedbackOf(SAT);
    await sendNotification(deps, 'morning', jst(SUN, '08:30'));
    expect(sent).toEqual([
      {
        kind: 'morning',
        title: '朝の計画',
        body: '昨日のFBが届いています。持ち越しが2件あります',
        path: '/morning',
      },
    ]);
  });

  it('最後の FB が昨日のものでなければ、「昨日のFB」とは書かない', async () => {
    previousFeedback = feedbackOf('2026-10-01');
    await sendNotification(deps, 'morning', jst(SUN, '08:30'));
    expect(sent[0]?.body).toBe('持ち越しが2件あります');
  });

  it('計画を確定していれば送らない', async () => {
    deps.logs = {
      find: (day) =>
        day === SUN
          ? {
              day,
              thoughtsMd: '',
              learningMd: '',
              planConfirmedAt: jst(SUN, '08:00').toISOString(),
              updatedAt: jst(SUN, '08:00').toISOString(),
            }
          : undefined,
    };
    await sendNotification(deps, 'morning', jst(SUN, '08:30'));
    expect(sent).toEqual([]);
  });
});

describe('FR-N02 夜の通知（結合）', () => {
  beforeEach(async () => {
    // 水曜から待ちの「競合調査」は、土曜で4日目
    now = jst('2026-09-30', '10:00');
    const research = await addTask('2026-09-30', '競合調査', 'today');
    const doing = await transition('2026-09-30', research, 'doing');
    await transition('2026-09-30', doing, 'waiting');
    now = jst(SAT, '10:00');
    for (const title of ['請求書', '見積もり']) {
      await complete(SAT, await addTask(SAT, title, 'today'));
    }
    now = jst(SAT, '21:30');
  });

  it('振り返りが未保存なら、完了件数といちばん長引いているタスクを書いて送る', async () => {
    await sendNotification(deps, 'evening', jst(SAT, '21:30'));
    expect(sent).toEqual([
      {
        kind: 'evening',
        title: '振り返り',
        body: '今日は2件完了。競合調査が待ちのまま4日目です',
        path: '/reflection',
      },
    ]);
  });

  it('振り返りを保存していれば送らない', async () => {
    await send('PUT', `/days/${SAT}/log`, { thoughtsMd: '今日は進んだ', learningMd: '' });
    await sendNotification(deps, 'evening', jst(SAT, '21:30'));
    expect(sent).toEqual([]);
  });

  it('復帰が遅れて日付をまたいでも、予定の時刻の業務日（業務日の切り替えの前）について判断する', async () => {
    // 21:30 の予定を、翌日 0:30（業務日はまだ土曜）に動かす
    now = jst(SUN, '00:30');
    await sendNotification(deps, 'evening', jst(SAT, '21:30'));
    expect(sent[0]?.body).toBe('今日は2件完了。競合調査が待ちのまま4日目です');
    expect(deps.sent.wasSent('evening', SAT)).toBe(true);
  });
});

describe('FR-N03 棚卸しの通知（結合）', () => {
  it('日曜の 21:45 に、スケジューラから棚卸しの対象の件数を送る', async () => {
    await addTask(SAT, '本棚の整理');
    await addTask(SAT, '写真の整理');
    reviewAfterDays = 0;
    now = jst(SUN, '21:00');
    const timer: { fire: () => void } = { fire: () => {} };
    const scheduler = createScheduler({
      now: () => now,
      timeZone: DAY_OPTIONS.timeZone,
      monotonic: () => now.getTime(),
      setTimer: (fn): TimerHandle => {
        timer.fire = fn;
        return { cancel: () => {} };
      },
    });
    for (const job of createNotificationJobs(deps)) scheduler.add(job);
    scheduler.start();
    expect(scheduler.nextRun('notification-inventory')).toEqual(jst(SUN, '21:45'));
    expect(scheduler.nextRun('notification-evening')).toEqual(jst(SUN, '21:30'));

    now = jst(SUN, '21:45');
    timer.fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((n) => [n.kind, n.body])).toEqual([
      ['evening', '今日の振り返りを書きましょう'],
      ['inventory', '棚卸しの対象が2件あります'],
    ]);
    expect(scheduler.nextRun('notification-inventory')).toEqual(jst('2026-10-11', '21:45'));
  });

  it('対象がなければ送らない', async () => {
    await addTask(SAT, '本棚の整理');
    now = jst(SUN, '21:45');
    await sendNotification(deps, 'inventory', jst(SUN, '21:45'));
    expect(sent).toEqual([]);
  });
});

describe('FR-N04 同じ種類の通知は1日1回', () => {
  it('同じ業務日にもう一度動いても送らず、次の業務日には送る', async () => {
    now = jst(SAT, '08:30');
    await sendNotification(deps, 'morning', jst(SAT, '08:30'));
    await sendNotification(deps, 'morning', jst(SAT, '08:30'));
    expect(sent).toHaveLength(1);
    now = jst(MON, '08:30');
    await sendNotification(deps, 'morning', jst(MON, '08:30'));
    expect(sent).toHaveLength(2);
  });

  it('通知を出せなかったら、送ったことにしない', async () => {
    now = jst(SAT, '08:30');
    adapterResult = { ok: false, message: '通知の権限がありません' };
    await sendNotification(deps, 'morning', jst(SAT, '08:30'));
    expect(deps.sent.wasSent('morning', SAT)).toBe(false);
    adapterResult = { ok: true };
    await sendNotification(deps, 'morning', jst(SAT, '08:30'));
    expect(sent).toHaveLength(1);
  });

  it('通知のアダプタが例外を投げても、送ったことにしない', async () => {
    now = jst(SAT, '08:30');
    const errors: string[] = [];
    deps.logger = { ...silent, error: (message) => errors.push(message) };
    deps.adapter = {
      notify: async () => {
        throw new Error('通知センターに接続できません');
      },
    };
    await sendNotification(deps, 'morning', jst(SAT, '08:30'));
    expect(deps.sent.wasSent('morning', SAT)).toBe(false);
    expect(errors).toEqual(['通知を出せませんでした']);
  });

  it('業務日の切り替え（5:00）の前と後では、別の日の通知として数える', async () => {
    now = jst(SUN, '04:59');
    await sendNotification(deps, 'morning', jst(SUN, '04:59'));
    now = jst(SUN, '05:00');
    await sendNotification(deps, 'morning', jst(SUN, '05:00'));
    expect(deps.sent.wasSent('morning', SAT)).toBe(true);
    expect(deps.sent.wasSent('morning', SUN)).toBe(true);
    expect(sent).toHaveLength(2);
  });
});
