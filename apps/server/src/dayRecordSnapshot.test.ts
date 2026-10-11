import { createFakeAgentRunner } from '@mymind/agent';
import {
  createDailyLogRepository,
  createDailyRecordRepository,
  createJobRepository,
  createSettingsRepository,
  createTagRepository,
  createTaskRepository,
  type DailyRecordRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { toBusinessDay } from '@mymind/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api';
import { createEventBus } from './events';
import { createJobRunner } from './jobRunner';

const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };
const TODAY = '2026-09-23';
const TOMORROW = '2026-09-24';

/** 2026-09-23 10:00（日本時間） */
let now = new Date('2026-09-23T01:00:00.000Z');
let api: ReturnType<typeof createApi>;
let records: DailyRecordRepository;
let runner: ReturnType<typeof createJobRunner>;
let fake: ReturnType<typeof createFakeAgentRunner>;

function setup(fakeDelayMs = 0) {
  now = new Date('2026-09-23T01:00:00.000Z');
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  let seq = 0;
  const newId = () => `id${String(++seq).padStart(5, '0')}`;
  const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
  const jobs = createJobRepository({ db, codec: plainCodec });
  const logs = createDailyLogRepository({ db, codec: plainCodec });
  const tags = createTagRepository({ db });
  records = createDailyRecordRepository({ db, codec: plainCodec });
  const events = createEventBus();
  fake = createFakeAgentRunner({ delayMs: fakeDelayMs });
  runner = createJobRunner({
    jobs,
    tasks,
    logs,
    tags,
    records,
    runners: { claude: fake, codex: fake },
    defaultAgent: () => 'claude',
    events,
    prompt: { text: 'プロンプト', version: '0.1.0' },
    monthlyPrompt: { text: '月次のプロンプト', version: '0.1.0' },
    now: () => now,
    today: () => toBusinessDay(now, DAY_OPTIONS),
    newId,
    timeoutMs: 1000,
  });
  api = createApi({
    tasks,
    now: () => now,
    dayOptions: DAY_OPTIONS,
    newId,
    jobs: { runner, jobs, events },
    records,
    health: {
      checkDatabase: () => ({ ok: true }),
      databaseFiles: [],
      backupsDirs: () => [],
      dailyBackup: () => null,
      jobs,
      agentStatus: async () => ({ name: 'fake', usable: true, executable: null, message: null }),
    },
    settings: createSettingsRepository({ db }),
    logs,
    tags,
  });
}

beforeEach(() => setup());

type TaskJson = { id: string; version: number; status: string };

const send = (method: string, path: string, body?: unknown) =>
  api.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const today = () => toBusinessDay(now, DAY_OPTIONS);

async function addTask(title: string): Promise<TaskJson> {
  const res = await send('POST', '/tasks', { title, expectedDay: today(), planFor: 'today' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { task: TaskJson }).task;
}

async function transition(task: TaskJson, to: string): Promise<TaskJson> {
  const res = await send('POST', `/tasks/${task.id}/transition`, {
    to,
    expectedVersion: task.version,
    expectedDay: today(),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { task: TaskJson }).task;
}

const saveLog = (day: string) =>
  send('PUT', `/days/${day}/log`, { thoughtsMd: '考えたこと', learningMd: '' });

const requestFeedback = (day: string) =>
  send('POST', '/jobs', { kind: 'daily_feedback', period: day });

type Regenerated = {
  hadSnapshot: boolean;
  changed: boolean;
  diff: { tasks: unknown[]; counts: unknown[]; completed: unknown } | null;
  counts: Record<string, number>;
  hasFeedback: boolean;
};

async function regenerate(day: string): Promise<Regenerated> {
  const res = await send('POST', `/days/${day}/record/regenerate`);
  expect(res.status).toBe(200);
  return (await res.json()) as Regenerated;
}

const statusesIn = (record: unknown) =>
  (record as { tasks: { status: string }[] }).tasks.map((t) => t.status);

describe('FR-R07 記録のスナップショットを取るとき', () => {
  it('振り返りを保存すると、その時点の記録を残す', async () => {
    await transition(await addTask('企画書'), 'doing');
    expect(records.find(TODAY)).toBeUndefined();

    expect((await saveLog(TODAY)).status).toBe(200);

    const saved = records.find(TODAY);
    expect(saved).toMatchObject({ source: 'log_saved', generatedAt: now.toISOString() });
    expect(saved?.record).toMatchObject({
      day: TODAY,
      counts: { planned: 1, doing: 1, done: 0 },
      tasks: [{ title: '企画書', status: 'doing', statusDays: 1 }],
    });
  });

  it('FB を依頼すると、その時点の記録で上書きする', async () => {
    const task = await transition(await addTask('企画書'), 'doing');
    await saveLog(TODAY);
    await transition(task, 'done');

    expect((await requestFeedback(TODAY)).status).toBe(202);
    await runner.idle();

    const saved = records.find(TODAY);
    expect(saved?.source).toBe('feedback_requested');
    expect(statusesIn(saved?.record)).toEqual(['done']);
  });
});

describe('FR-R07 FB の入力にスナップショットを使う', () => {
  it('依頼してから実行までの間にタスクが変わっても、依頼したときの記録で FB を作る', async () => {
    // 1件目の実行に時間がかかる間、2件目は待機になる
    setup(30);
    const task = await transition(await addTask('企画書'), 'doing');
    now = new Date('2026-09-24T01:00:00.000Z');
    const next = await transition(await addTask('見積もり'), 'doing');

    await requestFeedback(TODAY);
    await requestFeedback(TOMORROW);
    // 2件目を依頼した後で、実行される前に完了にする
    await transition(next, 'done');
    await runner.idle();

    expect(fake.inputs).toHaveLength(2);
    const second = fake.inputs[1] ?? '';
    expect(second).toContain('見積もり');
    expect(second).toContain('"status": "doing"');
    expect(second).not.toContain('"status": "done"');
    // 1件目（前の日）には、翌日に作ったタスクは入らない
    expect(fake.inputs[0]).not.toContain('見積もり');
    expect(task.status).toBe('doing');
  });

  it('過去の日の FB には、その日の終わりの状態を送る（後の日の操作は入らない）', async () => {
    const task = await transition(await addTask('企画書'), 'doing');
    now = new Date('2026-09-24T01:00:00.000Z');
    await transition(task, 'done');

    await requestFeedback(TODAY);
    await runner.idle();

    expect(fake.inputs[0]).toContain('"status": "doing"');
    expect(fake.inputs[0]).not.toContain('"status": "done"');
  });

  it('送信内容のプレビュー（FR-A12）は、依頼したときに保存される記録（今のイベント）で作る', async () => {
    const task = await transition(await addTask('企画書'), 'doing');
    await saveLog(TODAY);
    await transition(task, 'done');

    const res = await send('POST', '/agent-input/preview', {
      kind: 'daily_feedback',
      period: TODAY,
    });
    const preview = (await res.json()) as { payload: { stats: { done: number } } };
    expect(preview.payload.stats.done).toBe(1);
  });
});

describe('FR-R07 記録を再生成する', () => {
  it('スナップショットがなかった日は、作って保存し、比べるものがないと返す', async () => {
    await addTask('企画書');
    const result = await regenerate(TODAY);
    expect(result).toMatchObject({
      hadSnapshot: false,
      changed: false,
      diff: null,
      counts: { planned: 1 },
      hasFeedback: false,
    });
    expect(records.find(TODAY)?.source).toBe('regenerated');
  });

  it('スナップショットの後にイベントが変わっていれば、違いを返して上書きする', async () => {
    const task = await transition(await addTask('企画書'), 'doing');
    await saveLog(TODAY);
    await transition(task, 'done');

    const result = await regenerate(TODAY);

    expect(result.changed).toBe(true);
    expect(result.diff).toEqual({
      tasks: [
        { kind: 'status_changed', taskId: task.id, title: '企画書', from: 'doing', to: 'done' },
      ],
      counts: [
        { key: 'done', before: 0, after: 1 },
        { key: 'doing', before: 1, after: 0 },
      ],
      completed: { added: ['企画書'], removed: [] },
    });
    expect(records.find(TODAY)?.source).toBe('regenerated');
    expect(statusesIn(records.find(TODAY)?.record)).toEqual(['done']);
  });

  it('変わっていなければ、違いはないと返す', async () => {
    await transition(await addTask('企画書'), 'doing');
    await saveLog(TODAY);
    const result = await regenerate(TODAY);
    expect(result).toMatchObject({ hadSnapshot: true, changed: false });
    expect(result.diff).toEqual({ tasks: [], counts: [], completed: { added: [], removed: [] } });
  });

  it('過去の日は、その日の終わりの状態で作り直す（翌日に完了にしても変わらない）', async () => {
    const task = await transition(await addTask('企画書'), 'doing');
    await saveLog(TODAY);
    now = new Date('2026-09-24T01:00:00.000Z');
    await transition(task, 'done');

    const result = await regenerate(TODAY);
    expect(result.changed).toBe(false);
    expect(result.counts).toMatchObject({ doing: 1, done: 0 });
  });

  it('FB がある日は、もう一度依頼するかを選べるように hasFeedback を返す', async () => {
    await addTask('企画書');
    await requestFeedback(TODAY);
    await runner.idle();
    expect((await regenerate(TODAY)).hasFeedback).toBe(true);
  });

  it('形が合わないスナップショットは、ないものとして作り直す', async () => {
    await addTask('企画書');
    records.save({ day: TODAY, record: { broken: true }, source: 'log_saved', at: 'x' });
    expect(await regenerate(TODAY)).toMatchObject({ hadSnapshot: false, counts: { planned: 1 } });
  });

  it('まだ来ていない日と、形式の違う日は断る', async () => {
    expect((await send('POST', `/days/${TOMORROW}/record/regenerate`)).status).toBe(400);
    expect((await send('POST', '/days/2026-9-1/record/regenerate')).status).toBe(400);
  });
});
