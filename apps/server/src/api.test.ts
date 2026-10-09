import { createFakeAgentRunner } from '@mymind/agent';
import {
  createDailyLogRepository,
  createJobRepository,
  createSettingsRepository,
  createTagRepository,
  createTaskRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { toBusinessDay } from '@mymind/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api';
import { createApp } from './app';
import { createEventBus } from './events';
import { createJobRunner } from './jobRunner';
import { TOKEN_HEADER } from './security';

const PORT = 4820;
const TOKEN = 'token';
const TODAY = '2026-09-23';
const TOMORROW = '2026-09-24';

/** 2026-09-23 10:00（日本時間） */
let now = new Date('2026-09-23T01:00:00.000Z');
let app: ReturnType<typeof createApp>;
/** FB の生成を待つテストで使う */
let jobRunner: ReturnType<typeof createJobRunner>;

beforeEach(() => {
  now = new Date('2026-09-23T01:00:00.000Z');
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  let seq = 0;
  const newId = () => `id${String(++seq).padStart(5, '0')}`;
  const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
  const jobs = createJobRepository({ db, codec: plainCodec });
  const events = createEventBus();
  const runner = createJobRunner({
    jobs,
    tasks,
    logs: createDailyLogRepository({ db, codec: plainCodec }),
    tags: createTagRepository({ db }),
    runners: { claude: createFakeAgentRunner(), codex: createFakeAgentRunner() },
    defaultAgent: () => 'claude',
    events,
    prompt: { text: 'プロンプト', version: '0.1.0' },
    monthlyPrompt: { text: '月次のプロンプト', version: '0.1.0' },
    now: () => now,
    today: () => toBusinessDay(now, { timeZone: 'Asia/Tokyo', dayStartHour: 5 }),
    newId,
    timeoutMs: 1000,
  });
  jobRunner = runner;
  const api = createApi({
    tasks,
    now: () => now,
    dayOptions: { timeZone: 'Asia/Tokyo', dayStartHour: 5 },
    newId,
    jobs: { runner, jobs, events },
    health: {
      checkDatabase: () => ({ ok: true }),
      databaseFiles: [],
      backupsDirs: () => ['/nonexistent'],
      dailyBackup: () => null,
      jobs,
      agentStatus: async () => ({ name: 'fake', usable: true, executable: null, message: null }),
    },
    settings: createSettingsRepository({ db }),
    logs: createDailyLogRepository({ db, codec: plainCodec }),
    tags: createTagRepository({ db }),
  });
  app = createApp({ ports: [PORT], sessionToken: TOKEN }, api);
});

const headers = {
  Host: `127.0.0.1:${PORT}`,
  'Sec-Fetch-Site': 'same-origin',
  Origin: `http://127.0.0.1:${PORT}`,
  [TOKEN_HEADER]: TOKEN,
  'Content-Type': 'application/json',
};

const get = (path: string) => app.request(`/api${path}`, { headers });
const send = (method: string, path: string, body: unknown) =>
  app.request(`/api${path}`, { method, headers, body: JSON.stringify(body) });

type TaskJson = {
  id: string;
  status: string;
  version: number;
  title: string;
  parentId: string | null;
};

async function addTask(extra: Record<string, unknown> = {}): Promise<TaskJson> {
  const res = await send('POST', '/tasks', { title: '企画書を書く', expectedDay: TODAY, ...extra });
  expect(res.status).toBe(201);
  return ((await res.json()) as { task: TaskJson }).task;
}

const transition = (task: TaskJson, to: string, extra: Record<string, unknown> = {}) =>
  send('POST', `/tasks/${task.id}/transition`, {
    to,
    expectedVersion: task.version,
    expectedDay: TODAY,
    ...extra,
  });

const move = (task: TaskJson, to: string) =>
  send('POST', `/tasks/${task.id}/move`, {
    to,
    expectedVersion: task.version,
    expectedDay: TODAY,
  });

const planIds = async (day: string) =>
  ((await (await get(`/days/${day}`)).json()) as { tasks: TaskJson[] }).tasks.map((t) => t.id);
const backlogIds = async () =>
  ((await (await get('/backlog')).json()) as { tasks: TaskJson[] }).tasks.map((t) => t.id);

describe('FR-T01 タスクの追加', () => {
  it('今日の画面から追加すると、今日の計画に入る', async () => {
    const task = await addTask({ planFor: 'today' });
    expect(task).toMatchObject({ title: '企画書を書く', status: 'todo', version: 1 });
    expect(await planIds(TODAY)).toEqual([task.id]);
    expect(await backlogIds()).toEqual([]);
  });

  it('計画を指定しなければ、バックログに入る', async () => {
    const task = await addTask();
    expect(await backlogIds()).toEqual([task.id]);
    expect(await planIds(TODAY)).toEqual([]);
  });

  it('子タスクを追加できる', async () => {
    const parent = await addTask();
    expect(await addTask({ parentId: parent.id })).toMatchObject({ parentId: parent.id });
  });

  it('子タスクの下には追加できない（3階層目は 422）', async () => {
    const parent = await addTask();
    const child = await addTask({ parentId: parent.id });
    const res = await send('POST', '/tasks', {
      title: '孫',
      parentId: child.id,
      expectedDay: TODAY,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'DEPTH_EXCEEDED' } });
  });
});

describe('FR-T03 ステータスの変更', () => {
  it('遷移表で許される変更を保存し、version を上げる', async () => {
    const task = await addTask({ planFor: 'today' });
    const res = await transition(task, 'doing');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      task: { status: 'doing', version: 2 },
      affected: [],
      suggestions: [],
    });
  });

  it('遷移表にない変更は 422 で拒否する', async () => {
    const task = await addTask();
    const res = await transition(task, 'done');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: 'INVALID_TRANSITION', from: 'todo', to: 'done' },
    });
  });

  it('子を着手すると、未着手の親も着手中になる（FR-T07）', async () => {
    const parent = await addTask();
    const child = await addTask({ parentId: parent.id });
    const res = await transition(child, 'doing');
    expect(await res.json()).toMatchObject({
      task: { id: child.id, status: 'doing' },
      affected: [{ id: parent.id, status: 'doing' }],
    });
  });

  it('最後の子を完了すると、親の完了を提案する（FR-T08）', async () => {
    const parent = await addTask();
    const child = await addTask({ parentId: parent.id });
    const doing = (await (await transition(child, 'doing')).json()) as { task: TaskJson };
    const res = await transition(doing.task, 'done');
    expect(await res.json()).toMatchObject({
      suggestions: [{ kind: 'complete_parent', parentId: parent.id }],
    });
  });

  it('存在しないタスクは 404', async () => {
    const res = await send('POST', '/tasks/missing/transition', {
      to: 'doing',
      expectedVersion: 1,
      expectedDay: TODAY,
    });
    expect(res.status).toBe(404);
  });
});

describe('FR-T05 今日・明日・バックログへの移動', () => {
  it('今日の計画から明日へ移す', async () => {
    const task = await addTask({ planFor: 'today' });
    const res = await move(task, 'tomorrow');
    expect(res.status).toBe(200);
    expect(await planIds(TODAY)).toEqual([]);
    expect(await planIds(TOMORROW)).toEqual([task.id]);
    expect(await backlogIds()).toEqual([]);
  });

  it('バックログから今日へ移す', async () => {
    const task = await addTask();
    await move(task, 'today');
    expect(await planIds(TODAY)).toEqual([task.id]);
    expect(await backlogIds()).toEqual([]);
  });

  it('着手中のタスクをバックログへ移すと、中断にして取り消しを提案する（FR-T06）', async () => {
    const task = await addTask({ planFor: 'today' });
    const doing = (await (await transition(task, 'doing')).json()) as { task: TaskJson };
    const res = await move(doing.task, 'backlog');
    expect(await res.json()).toMatchObject({
      task: { status: 'paused' },
      suggestions: [{ kind: 'undo_auto_pause', taskId: task.id }],
    });
    expect(await backlogIds()).toEqual([task.id]);
  });

  it('すでに移す先にあれば、何も変えずに今の状態を返す', async () => {
    const task = await addTask({ planFor: 'today' });
    const res = await move(task, 'today');
    expect(await res.json()).toMatchObject({ task: { version: 1 }, suggestions: [] });
  });
});

describe('FR-T09 タスクの編集', () => {
  it('タイトルとメモを変える', async () => {
    const task = await addTask();
    const res = await send('PATCH', `/tasks/${task.id}`, {
      title: '企画書を仕上げる',
      noteMd: '## 背景',
      expectedVersion: 1,
      expectedDay: TODAY,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      task: { title: '企画書を仕上げる', noteMd: '## 背景', version: 2 },
    });
  });
});

describe('NFR-13 古い画面からの更新', () => {
  it('version が古ければ 409 で拒否し、何も変えない', async () => {
    const task = await addTask({ planFor: 'today' });
    await transition(task, 'doing');
    const res = await transition(task, 'cancelled');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });
  });

  it('編集でも version が古ければ 409', async () => {
    const task = await addTask();
    await send('PATCH', `/tasks/${task.id}`, {
      title: 'A',
      expectedVersion: 1,
      expectedDay: TODAY,
    });
    const res = await send('PATCH', `/tasks/${task.id}`, {
      title: 'B',
      expectedVersion: 1,
      expectedDay: TODAY,
    });
    expect(res.status).toBe(409);
  });

  it('移動でも version が古ければ 409', async () => {
    const task = await addTask({ planFor: 'today' });
    await move(task, 'tomorrow');
    const res = await move(task, 'backlog');
    expect(res.status).toBe(409);
  });
});

describe('NFR-14 業務日の切り替え', () => {
  it('画面の業務日と現在の業務日が違えば 409（DAY_CHANGED）で拒否する', async () => {
    const task = await addTask();
    now = new Date('2026-09-23T20:00:00.000Z'); // 翌日 5:00（日本時間）
    const res = await transition(task, 'doing');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'DAY_CHANGED', currentDay: TOMORROW },
    });
  });

  it('切り替え時刻の直前は、まだ同じ業務日として受け付ける', async () => {
    const task = await addTask();
    now = new Date('2026-09-23T19:59:59.999Z'); // 翌日 4:59（日本時間）
    expect((await transition(task, 'doing')).status).toBe(200);
  });

  it('allowPastDay を付ければ、前の日の記録として受け付ける', async () => {
    const task = await addTask();
    now = new Date('2026-09-23T20:00:00.000Z');
    const res = await transition(task, 'doing', { allowPastDay: true });
    expect(res.status).toBe(200);
  });

  it('追加でも業務日が違えば 409', async () => {
    now = new Date('2026-09-23T20:00:00.000Z');
    const res = await send('POST', '/tasks', { title: 'A', expectedDay: TODAY });
    expect(res.status).toBe(409);
  });
});

describe('NFR-02 入力の検証', () => {
  it.each([
    ['タイトルが空', 'POST', '/tasks', { title: '  ', expectedDay: TODAY }],
    ['業務日の形式が違う', 'POST', '/tasks', { title: 'A', expectedDay: '9/23' }],
    ['知らない項目がある', 'POST', '/tasks', { title: 'A', expectedDay: TODAY, due: 'x' }],
    ['planFor が不正', 'POST', '/tasks', { title: 'A', expectedDay: TODAY, planFor: 'someday' }],
    [
      'ステータスが不正',
      'POST',
      '/tasks/x/transition',
      { to: 'started', expectedVersion: 1, expectedDay: TODAY },
    ],
    ['version がない', 'POST', '/tasks/x/transition', { to: 'doing', expectedDay: TODAY }],
    [
      '移動先が不正',
      'POST',
      '/tasks/x/move',
      { to: 'later', expectedVersion: 1, expectedDay: TODAY },
    ],
    ['編集する項目がない', 'PATCH', '/tasks/x', { expectedVersion: 1, expectedDay: TODAY }],
  ])('%s なら 400', async (_, method, path, body) => {
    const res = await send(method, path, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('本文が JSON でなければ 400', async () => {
    const res = await app.request('/api/tasks', { method: 'POST', headers, body: '{' });
    expect(res.status).toBe(400);
  });

  it('業務日のパラメーターが不正なら 400', async () => {
    expect((await get('/days/today')).status).toBe(400);
  });

  it('トークンのない状態変更は、検証の前に 403 で拒否する', async () => {
    const { [TOKEN_HEADER]: _, ...noToken } = headers;
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: noToken,
      body: JSON.stringify({ title: 'A', expectedDay: TODAY }),
    });
    expect(res.status).toBe(403);
  });
});

describe('FR-T12 一覧に表示する日数と親子の情報', () => {
  type ListItem = TaskJson & {
    statusSince: string;
    parentTitle: string | null;
    children: { total: number; closed: number };
  };
  const planItems = async (day: string) =>
    ((await (await get(`/days/${day}`)).json()) as { tasks: ListItem[] }).tasks;

  it('今の状態になった業務日を返す（着手から何日目の計算に使う）', async () => {
    const task = await addTask({ planFor: 'today' });
    now = new Date('2026-09-24T01:00:00.000Z'); // 翌日
    expect((await transition(task, 'doing', { expectedDay: TOMORROW })).status).toBe(200);
    const res = await send('POST', `/tasks/${task.id}/move`, {
      to: 'today',
      expectedVersion: 2,
      expectedDay: TOMORROW,
    });
    expect(res.status).toBe(200);
    const [item] = await planItems(TOMORROW);
    expect(item).toMatchObject({ status: 'doing', statusSince: TOMORROW });
  });

  it('親の名前と、子の数・終わった子の数を返す', async () => {
    const parent = await addTask({ title: 'TODOツール MVP', planFor: 'today' });
    const child = await addTask({
      title: 'D1のスキーマ設計',
      parentId: parent.id,
      planFor: 'today',
    });
    await addTask({ title: 'Honoでルーティング', parentId: parent.id });
    await transition(child, 'cancelled');
    const items = await planItems(TODAY);
    expect(items.find((t) => t.id === parent.id)).toMatchObject({
      parentTitle: null,
      children: { total: 2, closed: 1 },
    });
    expect(items.find((t) => t.id === child.id)).toMatchObject({
      parentTitle: 'TODOツール MVP',
      children: { total: 0, closed: 0 },
    });
  });

  it('タスクの履歴を記録した順に返す', async () => {
    const task = await addTask({ planFor: 'today' });
    await transition(task, 'doing');
    const res = await get(`/tasks/${task.id}/events`);
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: { type: string }[] };
    expect(events.map((e) => e.type)).toEqual(['created', 'planned', 'status_changed']);
  });

  it('存在しないタスクの履歴は 404', async () => {
    expect((await get('/tasks/missing/events')).status).toBe(404);
  });
});

describe('FR-T02 親の付け替え', () => {
  const patch = (task: TaskJson, body: Record<string, unknown>) =>
    send('PATCH', `/tasks/${task.id}`, {
      expectedVersion: task.version,
      expectedDay: TODAY,
      ...body,
    });

  it('別のタスクの子にでき、親から外すこともできる', async () => {
    const parent = await addTask({ title: '親' });
    const task = await addTask({ title: '子になる' });
    const res = await patch(task, { parentId: parent.id });
    expect(res.status).toBe(200);
    const moved = ((await res.json()) as { task: TaskJson }).task;
    expect(moved.parentId).toBe(parent.id);
    const back = await patch(moved, { parentId: null });
    expect(((await back.json()) as { task: TaskJson }).task.parentId).toBeNull();
  });

  it('子を持つタスクは、別のタスクの子にできない（3階層目は 422）', async () => {
    const a = await addTask({ title: 'A' });
    const b = await addTask({ title: 'B' });
    await addTask({ title: 'Bの子', parentId: b.id });
    const res = await patch(b, { parentId: a.id });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'DEPTH_EXCEEDED' } });
  });

  it('存在しない親は 404', async () => {
    const task = await addTask();
    expect((await patch(task, { parentId: 'missing' })).status).toBe(404);
  });
});

describe('FR-T10 並べ替え', () => {
  const patch = (task: TaskJson, body: Record<string, unknown>) =>
    send('PATCH', `/tasks/${task.id}`, {
      expectedVersion: task.version,
      expectedDay: TODAY,
      ...body,
    });

  it('今日の計画の中の並び順を変える', async () => {
    const a = await addTask({ title: 'A', planFor: 'today' });
    const b = await addTask({ title: 'B', planFor: 'today' });
    expect(await planIds(TODAY)).toEqual([a.id, b.id]);
    await patch(b, { order: { in: 'plan', value: 0.5 } });
    expect(await planIds(TODAY)).toEqual([b.id, a.id]);
  });

  it('バックログの中の並び順を変える', async () => {
    const a = await addTask({ title: 'A' });
    const b = await addTask({ title: 'B' });
    await patch(b, { order: { in: 'backlog', value: 0.5 } });
    expect(await backlogIds()).toEqual([b.id, a.id]);
  });
});

describe('FR-D06 FR-D08 振り返りの保存', () => {
  type LogJson = { day: string; thoughtsMd: string; learningMd: string; updatedAt: string };
  const readLog = async (day: string) => {
    const res = await get(`/days/${day}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { log: LogJson | null }).log;
  };

  it('保存していない日の log は null', async () => {
    expect(await readLog(TODAY)).toBeNull();
  });

  it('保存した振り返りが、その日の GET で返る', async () => {
    const res = await send('PUT', `/days/${TODAY}/log`, {
      thoughtsMd: '# 考えたこと\n- 企画書が進んだ',
      learningMd: '先に骨子を書くと速い',
    });
    expect(res.status).toBe(200);
    expect(await readLog(TODAY)).toEqual({
      day: TODAY,
      thoughtsMd: '# 考えたこと\n- 企画書が進んだ',
      learningMd: '先に骨子を書くと速い',
      planConfirmedAt: null,
      updatedAt: now.toISOString(),
    });
  });

  it('一行だけ、片方の欄だけでも保存できる', async () => {
    const res = await send('PUT', `/days/${TODAY}/log`, { thoughtsMd: '疲れた', learningMd: '' });
    expect(res.status).toBe(200);
    expect(await readLog(TODAY)).toMatchObject({ thoughtsMd: '疲れた', learningMd: '' });
  });

  it('同じ日に保存し直すと上書きする', async () => {
    await send('PUT', `/days/${TODAY}/log`, { thoughtsMd: '前', learningMd: '前' });
    now = new Date('2026-09-23T02:00:00.000Z');
    await send('PUT', `/days/${TODAY}/log`, { thoughtsMd: '後', learningMd: '' });
    expect(await readLog(TODAY)).toMatchObject({
      thoughtsMd: '後',
      learningMd: '',
      updatedAt: '2026-09-23T02:00:00.000Z',
    });
  });

  it('過去の日の振り返りも保存できる', async () => {
    const res = await send('PUT', '/days/2026-09-20/log', {
      thoughtsMd: 'あとから',
      learningMd: '',
    });
    expect(res.status).toBe(200);
    expect(await readLog('2026-09-20')).toMatchObject({ thoughtsMd: 'あとから' });
  });

  it('業務日の切り替え時刻の前なら、暦の上では翌日でも前日の振り返りとして保存できる', async () => {
    // 2026-09-24 04:59（日本時間）は、業務日ではまだ 2026-09-23
    now = new Date('2026-09-23T19:59:00.000Z');
    expect(
      (await send('PUT', `/days/${TOMORROW}/log`, { thoughtsMd: 'a', learningMd: '' })).status,
    ).toBe(400);
    expect(
      (await send('PUT', `/days/${TODAY}/log`, { thoughtsMd: 'a', learningMd: '' })).status,
    ).toBe(200);
    // 05:00 を過ぎると 2026-09-24 に書ける
    now = new Date('2026-09-23T20:00:00.000Z');
    expect(
      (await send('PUT', `/days/${TOMORROW}/log`, { thoughtsMd: 'a', learningMd: '' })).status,
    ).toBe(200);
  });

  it('まだ来ていない日の振り返りは 400 で拒否する', async () => {
    const res = await send('PUT', `/days/${TOMORROW}/log`, { thoughtsMd: 'a', learningMd: '' });
    expect(res.status).toBe(400);
    expect(await readLog(TOMORROW)).toBeNull();
  });

  it('業務日の形式が不正なら 400', async () => {
    const res = await send('PUT', '/days/today/log', { thoughtsMd: 'a', learningMd: '' });
    expect(res.status).toBe(400);
  });

  it('欄が足りない、または余計な項目がある本文は 400', async () => {
    expect((await send('PUT', `/days/${TODAY}/log`, { thoughtsMd: 'a' })).status).toBe(400);
    expect(
      (await send('PUT', `/days/${TODAY}/log`, { thoughtsMd: 'a', learningMd: '', extra: 1 }))
        .status,
    ).toBe(400);
  });

  it('トークンのない保存は 403 で拒否する', async () => {
    const { [TOKEN_HEADER]: _, ...noToken } = headers;
    const res = await app.request(`/api/days/${TODAY}/log`, {
      method: 'PUT',
      headers: noToken,
      body: JSON.stringify({ thoughtsMd: 'a', learningMd: '' }),
    });
    expect(res.status).toBe(403);
    expect(await readLog(TODAY)).toBeNull();
  });
});

describe('FR-D07 振り返りの冒頭の記録のまとめ', () => {
  const step = async (task: TaskJson, to: string) => {
    const res = await transition(task, to);
    expect(res.status).toBe(200);
    return ((await res.json()) as { task: TaskJson }).task;
  };

  it('その日の完了・着手・変化を、件数と日数を計算して返す', async () => {
    const done = await step(
      await step(await addTask({ title: '経費精算', planFor: 'today' }), 'doing'),
      'done',
    );
    await step(await addTask({ title: 'スキーマ設計', planFor: 'today' }), 'doing');
    await step(await step(await addTask({ title: '週報', planFor: 'today' }), 'doing'), 'paused');
    await addTask({ title: '手をつけていない', planFor: 'today' });

    const body = (await (await get(`/days/${TODAY}`)).json()) as {
      summary: { completed: unknown[]; started: unknown[]; changes: unknown[] };
    };
    expect(body.summary.completed).toEqual([{ taskId: done.id, title: '経費精算' }]);
    expect(body.summary.started).toEqual([
      expect.objectContaining({ title: 'スキーマ設計', isNew: true, dayOrdinal: 1 }),
    ]);
    // 週報は、この日に作ったので始めの状態は未着手
    expect(body.summary.changes).toEqual([
      expect.objectContaining({ kind: 'changed', title: '週報', from: 'todo', to: 'paused' }),
    ]);
  });

  it('何もない日は、どの欄も空', async () => {
    const body = (await (await get('/days/2026-09-01')).json()) as { summary: unknown };
    expect(body.summary).toEqual({ completed: [], started: [], changes: [] });
  });
});

describe('FR-D03 FR-D04 FR-D05 FR-D09 朝の計画', () => {
  /** その業務日の 10:00（日本時間）に時計を合わせる */
  const setDay = (day: string) => {
    now = new Date(`${day}T01:00:00.000Z`);
  };
  const addOn = async (day: string, title: string, planFor?: 'today') => {
    setDay(day);
    const res = await send('POST', '/tasks', {
      title,
      expectedDay: day,
      ...(planFor === undefined ? {} : { planFor }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { task: TaskJson }).task;
  };
  const stepOn = async (day: string, task: TaskJson, to: string) => {
    setDay(day);
    const res = await send('POST', `/tasks/${task.id}/transition`, {
      to,
      expectedVersion: task.version,
      expectedDay: day,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { task: TaskJson }).task;
  };
  type Carryover = {
    baseDay: string | null;
    blankDays: number;
    confirmedAt: string | null;
    candidates: TaskJson[];
  };
  const carryover = async (day: string) =>
    (await (await get(`/days/${day}/carryover`)).json()) as Carryover;
  const confirm = (day: string, body: Record<string, unknown>) =>
    send('POST', `/days/${day}/plan`, { expectedDay: day, decisions: [], additions: [], ...body });

  it('空白日をはさんでも、最後に計画した日の未完了のタスクを候補にし、空白日数を返す', async () => {
    const open = await addOn('2026-09-19', '企画書', 'today');
    await stepOn(
      '2026-09-19',
      await stepOn('2026-09-19', await addOn('2026-09-19', '週報', 'today'), 'doing'),
      'done',
    );
    setDay('2026-09-23');
    const body = await carryover('2026-09-23');
    expect(body).toMatchObject({ baseDay: '2026-09-19', blankDays: 3, confirmedAt: null });
    expect(body.candidates.map((t) => t.id)).toEqual([open.id]);
  });

  it('計画が一度もなければ、基準日はなく候補も空', async () => {
    expect(await carryover(TODAY)).toMatchObject({ baseDay: null, blankDays: 0, candidates: [] });
  });

  it('3つの判断とバックログからの追加を、まとめて反映する', async () => {
    const keep = await addOn('2026-09-22', '今日もやる', 'today');
    const later = await stepOn('2026-09-22', await addOn('2026-09-22', 'あとで', 'today'), 'doing');
    const finished = await addOn('2026-09-22', '実は終わった', 'today');
    const fromBacklog = await addOn('2026-09-22', 'バックログのタスク');
    setDay(TODAY);

    const res = await confirm(TODAY, {
      decisions: [
        { taskId: keep.id, decision: 'today' },
        { taskId: later.id, decision: 'backlog' },
        { taskId: finished.id, decision: 'done' },
      ],
      additions: [fromBacklog.id],
    });
    expect(res.status).toBe(200);
    expect(await planIds(TODAY)).toEqual([keep.id, fromBacklog.id]);
    expect(await backlogIds()).toEqual([later.id]);

    const status = async (id: string) =>
      (
        (await (await get(`/tasks/${id}/events`)).json()) as {
          events: { type: string; to?: string }[];
        }
      ).events.flatMap((e) => (e.type === 'status_changed' ? [e.to] : []));
    // 着手中のままバックログへ送ると中断になる（FR-T06）
    expect(await status(later.id)).toEqual(['doing', 'paused']);
    // 未着手の「実は終わった」は、着手中を経て完了にする
    expect(await status(finished.id)).toEqual(['doing', 'done']);
  });

  it('確定した後は候補を返さず、もう一度は確定できない', async () => {
    const task = await addOn('2026-09-22', 'バックログへ送る', 'today');
    setDay(TODAY);
    expect(
      (await confirm(TODAY, { decisions: [{ taskId: task.id, decision: 'backlog' }] })).status,
    ).toBe(200);
    const body = await carryover(TODAY);
    expect(body.candidates).toEqual([]);
    expect(body.confirmedAt).toBe(now.toISOString());
    expect((await confirm(TODAY, {})).status).toBe(409);
  });

  it('判断の抜けや、候補にないタスクへの判断は 400 で、何も反映しない', async () => {
    const a = await addOn('2026-09-22', 'A', 'today');
    await addOn('2026-09-22', 'B', 'today');
    const other = await addOn('2026-09-22', 'バックログ');
    setDay(TODAY);
    expect(
      (await confirm(TODAY, { decisions: [{ taskId: a.id, decision: 'today' }] })).status,
    ).toBe(400);
    expect(
      (await confirm(TODAY, { decisions: [{ taskId: other.id, decision: 'today' }] })).status,
    ).toBe(400);
    expect(await planIds(TODAY)).toEqual([]);
    expect((await carryover(TODAY)).confirmedAt).toBeNull();
  });

  it('バックログにないタスクは追加できない', async () => {
    const planned = await addOn(TODAY, '今日の計画にある', 'today');
    expect((await confirm(TODAY, { additions: [planned.id] })).status).toBe(400);
  });

  it('画面の業務日とパスの業務日が違えば 400、今の業務日と違えば 409', async () => {
    setDay(TODAY);
    expect(
      (
        await send('POST', `/days/${TODAY}/plan`, {
          expectedDay: TOMORROW,
          decisions: [],
          additions: [],
        })
      ).status,
    ).toBe(400);
    expect((await confirm(TOMORROW, {})).status).toBe(409);
  });
});

describe('FR-R04 FR-A09 月の API', () => {
  type MonthJson = {
    ym: string;
    today: string;
    days: {
      day: string;
      isFuture: boolean;
      isBlank: boolean;
      completedCount: number;
      hasReflection: boolean;
      hasFeedback: boolean;
      condition: { aiLevel: number | null; userLevel: number | null } | null;
    }[];
  };
  const month = async (ym: string) => (await (await get(`/months/${ym}`)).json()) as MonthJson;
  const dayOf = (m: MonthJson, day: string) => m.days.find((d) => d.day === day);

  it('月の日を1日から月末まで並べ、今日より後の日はまだ来ていない日として中身を返さない', async () => {
    const m = await month('2026-09');
    expect(m).toMatchObject({ ym: '2026-09', today: TODAY });
    expect(m.days).toHaveLength(30);
    expect(dayOf(m, TODAY)?.isFuture).toBe(false);
    expect(dayOf(m, TOMORROW)).toEqual({
      day: TOMORROW,
      isFuture: true,
      isBlank: false,
      completedCount: 0,
      hasReflection: false,
      hasFeedback: false,
      condition: null,
    });
  });

  it('完了件数を、振り返りの「完了」と同じ定義でその日に数える', async () => {
    const task = await addTask({ planFor: 'today' });
    const doing = ((await (await transition(task, 'doing')).json()) as { task: TaskJson }).task;
    expect((await transition(doing, 'done')).status).toBe(200);
    await addTask({ planFor: 'today', title: '未着手のまま' });
    expect(dayOf(await month('2026-09'), TODAY)).toMatchObject({
      completedCount: 1,
      isBlank: false,
    });
  });

  it('計画も振り返りもない日は空白日にし、FB のない日は調子を空にする', async () => {
    const m = await month('2026-09');
    expect(dayOf(m, '2026-09-20')).toMatchObject({
      isBlank: true,
      hasReflection: false,
      hasFeedback: false,
      condition: null,
    });
  });

  it('振り返りと FB と調子があれば、その日に示す', async () => {
    const day = '2026-09-21';
    expect(
      (await send('PUT', `/days/${day}/log`, { thoughtsMd: '集中できた', learningMd: '' })).status,
    ).toBe(200);
    expect((await send('POST', '/jobs', { kind: 'daily_feedback', period: day })).status).toBe(202);
    await jobRunner.idle();
    expect((await send('PUT', `/days/${day}/condition`, { userLevel: 1 })).status).toBe(200);
    expect(dayOf(await month('2026-09'), day)).toMatchObject({
      isBlank: false,
      hasReflection: true,
      hasFeedback: true,
      condition: { aiLevel: expect.any(Number), userLevel: 1 },
    });
  });

  it('空白だけの振り返りは、振り返りありとしない', async () => {
    const day = '2026-09-19';
    await send('PUT', `/days/${day}/log`, { thoughtsMd: '  \n', learningMd: '' });
    expect(dayOf(await month('2026-09'), day)).toMatchObject({
      isBlank: false,
      hasReflection: false,
    });
  });

  it('年末の月と、まだ来ていない月も返す', async () => {
    const m = await month('2026-12');
    expect(m.days).toHaveLength(31);
    expect(m.days.at(-1)?.day).toBe('2026-12-31');
    expect(m.days.every((d) => d.isFuture)).toBe(true);
  });

  it.each(['2026-13', '2026-9', '202609', 'abcd-ef', '0001-01', '1969-12'])(
    '%s は 400',
    async (ym) => {
      expect((await get(`/months/${ym}`)).status).toBe(400);
    },
  );
});

describe('FR-R01 FR-R02 FR-R03 タイムラインの API', () => {
  type TimelineJson = {
    from: string;
    to: string;
    today: string;
    days: {
      day: string;
      isFuture: boolean;
      condition: { aiLevel: number | null; userLevel: number | null } | null;
    }[];
    tasks: {
      id: string;
      title: string;
      parentTitle: string | null;
      segments: { status: string; from: string; to: string; continuesAfter: boolean }[];
      breakdown: { doing: number; paused: number; waiting: number; startedDay: string | null };
    }[];
  };
  const timeline = async (from: string, to: string) =>
    (await (await get(`/timeline?from=${from}&to=${to}`)).json()) as TimelineJson;

  /** day の 10:00（日本時間）に、その日の操作として状態を変える */
  const changeOn = async (task: TaskJson, day: string, to: string): Promise<TaskJson> => {
    now = new Date(`${day}T01:00:00.000Z`);
    const res = await transition(task, to, { expectedDay: day });
    expect(res.status).toBe(200);
    return ((await res.json()) as { task: TaskJson }).task;
  };

  /** day の 10:00（日本時間）に、その日のタスクとして追加する */
  const addTaskOn = async (day: string, extra: Record<string, unknown> = {}) => {
    now = new Date(`${day}T01:00:00.000Z`);
    return addTask({ expectedDay: day, ...extra });
  };

  it('期間の中の区間と、着手してから今日までの内訳を返す', async () => {
    const parent = await addTaskOn('2026-09-20', { title: 'Q4計画' });
    const task = await addTaskOn('2026-09-20', { title: '企画書を書く', parentId: parent.id });
    const untouched = await addTaskOn('2026-09-20', { title: '着手しないタスク' });
    const doing = await changeOn(task, '2026-09-20', 'doing');
    await changeOn(doing, '2026-09-22', 'paused');
    now = new Date('2026-09-23T01:00:00.000Z');

    const t = await timeline('2026-09-17', '2026-09-23');
    expect(t).toMatchObject({ from: '2026-09-17', to: '2026-09-23', today: TODAY });
    const row = t.tasks.find((r) => r.id === task.id);
    expect(row).toMatchObject({
      title: '企画書を書く',
      parentTitle: 'Q4計画',
      segments: [
        { status: 'doing', from: '2026-09-20', to: '2026-09-21' },
        { status: 'paused', from: '2026-09-22', to: '2026-09-23', continuesAfter: true },
      ],
      breakdown: { doing: 2, paused: 2, waiting: 0, startedDay: '2026-09-20' },
    });
    // 子に着手すると、自動のルールで親も着手中になるので描く。着手していないタスクは描かない
    expect(t.tasks.map((r) => r.id)).toContain(parent.id);
    expect(t.tasks.map((r) => r.id)).not.toContain(untouched.id);
  });

  it('期間の前から続くタスクも、期間の中にイベントがなくても描く', async () => {
    const task = await addTaskOn('2026-09-01');
    await changeOn(task, '2026-09-01', 'doing');
    now = new Date('2026-09-23T01:00:00.000Z');
    const t = await timeline('2026-09-17', '2026-09-23');
    expect(t.tasks.find((r) => r.id === task.id)?.segments).toMatchObject([
      { status: 'doing', from: '2026-09-17', to: '2026-09-23' },
    ]);
  });

  it('日ごとの調子を並べ、FB のない日は空にし、今日より後の日は区間を描かない', async () => {
    const task = await addTaskOn('2026-09-22');
    await changeOn(task, '2026-09-22', 'doing');
    now = new Date('2026-09-23T01:00:00.000Z');
    expect((await send('PUT', '/days/2026-09-21/condition', { userLevel: 3 })).status).toBe(200);

    const t = await timeline('2026-09-20', '2026-09-26');
    expect(t.days).toHaveLength(7);
    expect(t.days.find((d) => d.day === '2026-09-21')?.condition).toEqual({
      aiLevel: null,
      userLevel: 3,
    });
    expect(t.days.find((d) => d.day === '2026-09-20')?.condition).toBeNull();
    expect(t.days.filter((d) => d.isFuture).map((d) => d.day)).toEqual([
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
    expect(t.tasks.find((r) => r.id === task.id)?.segments.at(-1)?.to).toBe(TODAY);
  });

  it('期間がまるごと先なら、タスクは返さない', async () => {
    const task = await addTask();
    await changeOn(task, TODAY, 'doing');
    expect((await timeline('2026-09-24', '2026-09-30')).tasks).toEqual([]);
  });

  it.each([
    ['from が to より後', '/timeline?from=2026-09-23&to=2026-09-17'],
    ['15日以上の期間', '/timeline?from=2026-09-01&to=2026-09-15'],
    ['業務日の形式でない', '/timeline?from=2026-9-1&to=2026-09-07'],
    ['to がない', '/timeline?from=2026-09-01'],
    ['存在しない日付', '/timeline?from=2026-02-30&to=2026-03-01'],
    ['うるう年でない年の2月29日', '/timeline?from=2027-02-23&to=2027-02-29'],
  ])('%s は 400', async (_, path) => {
    expect((await get(path)).status).toBe(400);
  });

  it('2週間（14日）までは受け付ける', async () => {
    expect((await get('/timeline?from=2026-09-10&to=2026-09-23')).status).toBe(200);
  });

  it('うるう年の2月29日と、月末をまたぐ期間を受け付ける', async () => {
    const t = (await (await get('/timeline?from=2028-02-27&to=2028-03-02')).json()) as TimelineJson;
    expect(t.days.map((d) => d.day)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
      '2028-03-02',
    ]);
  });
});

describe('FR-R06 棚卸しの API', () => {
  type StaleJson = {
    today: string;
    afterDays: number;
    tasks: (TaskJson & {
      createdDay: string;
      daysSinceTouched: number;
      hasStarted: boolean;
    })[];
  };
  const stale = async () => (await (await get('/review/stale')).json()) as StaleJson;

  /** day の 10:00（日本時間）に、バックログへ追加する */
  const addBacklogOn = async (day: string, title: string) => {
    now = new Date(`${day}T01:00:00.000Z`);
    const task = await addTask({ title, expectedDay: day });
    now = new Date('2026-09-23T01:00:00.000Z');
    return task;
  };
  const decide = (task: TaskJson, decision: string, extra: Record<string, unknown> = {}) =>
    send('POST', '/review/decisions', {
      taskId: task.id,
      expectedVersion: task.version,
      decision,
      expectedDay: TODAY,
      ...extra,
    });

  it('最後に触れてから30日以上経ったバックログのタスクを、古い順に日数を添えて返す', async () => {
    const newer = await addBacklogOn('2026-08-20', '本棚を整理する');
    const older = await addBacklogOn('2026-08-01', 'カメラのセンサー清掃');
    await addBacklogOn('2026-09-20', '最近のタスク');
    const s = await stale();
    expect(s).toMatchObject({ today: TODAY, afterDays: 30 });
    expect(s.tasks.map((t) => t.id)).toEqual([older.id, newer.id]);
    expect(s.tasks[0]).toMatchObject({
      createdDay: '2026-08-01',
      daysSinceTouched: 53,
      hasStarted: false,
    });
  });

  it('設定の日数を変えると、その日数で対象を選ぶ', async () => {
    const recent = await addBacklogOn('2026-09-20', '最近のタスク');
    expect((await send('PATCH', '/settings', { reviewAfterDays: 3 })).status).toBe(200);
    expect((await stale()).tasks.map((t) => t.id)).toEqual([recent.id]);
  });

  it('今日の計画にあるタスクは、日数が経っていても対象にしない', async () => {
    // 前日に「明日」の計画として足したタスク（今日の計画にある）。日数の設定を1日にして確かめる
    now = new Date('2026-09-22T01:00:00.000Z');
    await addTask({ title: '計画にある', planFor: 'tomorrow', expectedDay: '2026-09-22' });
    now = new Date('2026-09-23T01:00:00.000Z');
    expect((await send('PATCH', '/settings', { reviewAfterDays: 1 })).status).toBe(200);
    expect((await stale()).tasks).toEqual([]);
  });

  it('今週やるは今日の計画に入れ、棚卸しの対象から外す', async () => {
    const task = await addBacklogOn('2026-08-01', '本棚を整理する');
    expect((await decide(task, 'this_week')).status).toBe(200);
    expect(await planIds(TODAY)).toEqual([task.id]);
    expect((await stale()).tasks).toEqual([]);
  });

  it('残すは状態とイベントを変えずに、最後に触れた日時を進めて対象から外す', async () => {
    const task = await addBacklogOn('2026-08-01', '本棚を整理する');
    const before = (await (await get(`/tasks/${task.id}/events`)).json()) as { events: unknown[] };
    const res = await decide(task, 'keep');
    expect(await res.json()).toMatchObject({
      task: { status: 'todo', lastTouchedAt: now.toISOString() },
    });
    expect(await backlogIds()).toEqual([task.id]);
    expect((await stale()).tasks).toEqual([]);
    const after = (await (await get(`/tasks/${task.id}/events`)).json()) as { events: unknown[] };
    expect(after.events).toHaveLength(before.events.length);
  });

  it('中止はタスクを中止にし、バックログから外す', async () => {
    const task = await addBacklogOn('2026-08-01', '本棚を整理する');
    expect(await (await decide(task, 'drop')).json()).toMatchObject({
      task: { status: 'cancelled' },
    });
    expect(await backlogIds()).toEqual([]);
  });

  it('古い version からの判断は 409 にし、何も変えない', async () => {
    const task = await addBacklogOn('2026-08-01', '本棚を整理する');
    expect((await decide({ ...task, version: task.version + 1 }, 'drop')).status).toBe(409);
    expect((await stale()).tasks.map((t) => t.id)).toEqual([task.id]);
  });

  it('まだ日数が経っていないタスクの判断は 409 にし、何も変えない', async () => {
    const recent = await addBacklogOn('2026-09-20', '最近のタスク');
    expect(await (await decide(recent, 'drop')).json()).toMatchObject({
      error: { code: 'NOT_REVIEW_TARGET' },
    });
    expect(await backlogIds()).toEqual([recent.id]);
  });

  it('バックログにないタスクは 409、知らない判断は 400', async () => {
    const planned = await addTask({ planFor: 'today' });
    expect(await (await decide(planned, 'keep')).json()).toMatchObject({
      error: { code: 'NOT_IN_BACKLOG' },
    });
    const task = await addBacklogOn('2026-08-01', '本棚を整理する');
    expect((await decide(task, 'later')).status).toBe(400);
  });
});

describe('FR-A06 FR-R05 月の API の総括', () => {
  it('総括がなければ空で、依頼すると生成中のジョブを返し、終わると最新の総括を返す', async () => {
    const before = (await (await get('/months/2026-09')).json()) as {
      summary: unknown;
      summaryJob: unknown;
    };
    expect(before).toMatchObject({ summary: null, summaryJob: null });

    expect(
      (await send('POST', '/jobs', { kind: 'monthly_summary', period: '2026-09' })).status,
    ).toBe(202);
    expect(await (await get('/months/2026-09')).json()).toMatchObject({
      summaryJob: { kind: 'monthly_summary', period: '2026-09' },
    });

    await jobRunner.idle();
    expect(await (await get('/months/2026-09')).json()).toMatchObject({
      summary: { period: '2026-09', isPartial: true, content: { learnings: expect.any(Array) } },
      summaryJob: { status: 'succeeded' },
    });
  });
});

describe('FR-M02 タスク名の検索の API', () => {
  it('名前の部分一致で、状態や日数を添えて返す', async () => {
    await addTask({ title: '企画書ドラフトを書く' });
    await addTask({ title: '週報' });
    const res = await get(`/tasks/search?q=${encodeURIComponent('企画')}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      tasks: [{ title: '企画書ドラフトを書く', status: 'todo', statusSince: TODAY }],
    });
  });

  it.each([
    ['語がない', '/tasks/search'],
    ['空白だけ', `/tasks/search?q=${encodeURIComponent('  ')}`],
    ['101文字', `/tasks/search?q=${'あ'.repeat(101)}`],
  ])('%s は 400', async (_, path) => {
    expect((await get(path)).status).toBe(400);
  });
});

describe('FR-T13 タグの API', () => {
  type TagJson = { id: string; name: string; color: string };
  type TagsResult = { task: TaskJson; tags: TagJson[]; created?: boolean };
  const listTags = async () =>
    ((await (await get('/tags')).json()) as { tags: (TagJson & { taskCount: number })[] }).tags;
  const backlogTask = async (id: string) =>
    (
      (await (await get('/backlog')).json()) as { tasks: (TaskJson & { tags: TagJson[] })[] }
    ).tasks.find((t) => t.id === id);
  /** 付けた後のタスク（版が進む）を返す。次の操作に使う */
  const attach = (task: TaskJson, body: Record<string, unknown>) =>
    send('POST', `/tasks/${task.id}/tags`, {
      expectedVersion: task.version,
      expectedDay: TODAY,
      ...body,
    });
  const attachOk = async (task: TaskJson, name: string) => {
    const res = await attach(task, { name });
    expect(res.status).toBe(200);
    return (await res.json()) as TagsResult;
  };
  const detach = (task: TaskJson, tagId: string, extra: Record<string, unknown> = {}) =>
    send('DELETE', `/tasks/${task.id}/tags/${tagId}`, {
      expectedVersion: task.version,
      expectedDay: TODAY,
      ...extra,
    });

  it('名前と色を指定してタグを作れる。名前の前後と連続する空白は整える', async () => {
    const res = await send('POST', '/tags', { name: '  仕事   A ', color: 'teal' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { tag: TagJson }).tag).toMatchObject({
      name: '仕事 A',
      color: 'teal',
    });
    expect(await listTags()).toEqual([expect.objectContaining({ name: '仕事 A', taskCount: 0 })]);
  });

  it('大文字・小文字や全角・半角だけが違う名前のタグは作れない（409）', async () => {
    await send('POST', '/tags', { name: 'Work', color: 'rose' });
    const res = await send('POST', '/tags', { name: 'ｗｏｒｋ', color: 'plum' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DUPLICATE_TAG');
  });

  it('空の名前、長すぎる名前、決まった6色以外の色は 400', async () => {
    expect((await send('POST', '/tags', { name: '   ', color: 'rose' })).status).toBe(400);
    expect((await send('POST', '/tags', { name: 'あ'.repeat(31), color: 'rose' })).status).toBe(
      400,
    );
    expect((await send('POST', '/tags', { name: '仕事', color: 'red' })).status).toBe(400);
  });

  it('タスクに名前で付けると、ないタグは最初の色で作られ、一覧の行に出る。タスクの版は進む', async () => {
    const task = await addTask();
    const result = await attachOk(task, '仕事');
    expect(result).toMatchObject({ created: true, tags: [{ name: '仕事', color: 'rose' }] });
    expect(result.task.version).toBe(task.version + 1);
    expect(await backlogTask(task.id)).toMatchObject({
      version: task.version + 1,
      tags: [expect.objectContaining({ name: '仕事' })],
    });
  });

  it('あるタグを名前で付けると、作らずにそのタグを付ける。同じタグを2回付けても1つ', async () => {
    const task = await addTask();
    await send('POST', '/tags', { name: 'Work', color: 'indigo' });
    const first = await attachOk(task, 'work');
    expect(first).toMatchObject({ created: false, tags: [{ name: 'Work', color: 'indigo' }] });
    expect((await attachOk(first.task, 'WORK')).tags).toHaveLength(1);
    expect(await listTags()).toEqual([expect.objectContaining({ name: 'Work', taskCount: 1 })]);
  });

  it('1つのタスクに付けられるタグは10個まで（11個目は 422）', async () => {
    let task = await addTask();
    for (let i = 1; i <= 10; i++) task = (await attachOk(task, `タグ${i}`)).task;
    const res = await attach(task, { name: 'タグ11' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TOO_MANY_TAGS');
    expect(await listTags()).toHaveLength(10);
  });

  it('タスクから外すと、タグは残り、そのタスクの行からは消える', async () => {
    const attached = await attachOk(await addTask(), '仕事');
    const res = await detach(attached.task, (attached.tags[0] as TagJson).id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tags: [] });
    expect((await backlogTask(attached.task.id))?.tags).toEqual([]);
    expect(await listTags()).toEqual([expect.objectContaining({ name: '仕事', taskCount: 0 })]);
  });

  it('付いているタグを付けても、付いていないタグを外しても、版は進まない', async () => {
    const attached = await attachOk(await addTask(), '仕事');
    const again = await attachOk(attached.task, '仕事');
    expect(again.task.version).toBe(attached.task.version);
    const other = await send('POST', '/tags', { name: '家', color: 'rose' });
    const tag = ((await other.json()) as { tag: TagJson }).tag;
    const res = await detach(attached.task, tag.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TagsResult).task.version).toBe(attached.task.version);
  });

  it('ないタスクに付けようとすると 404', async () => {
    const res = await send('POST', '/tasks/nope/tags', {
      name: '仕事',
      expectedVersion: 1,
      expectedDay: TODAY,
    });
    expect(res.status).toBe(404);
  });

  it('NFR-13 古い版を見ている画面からは、付けることも外すこともできない（409）。タグも作らない', async () => {
    const task = await addTask();
    const attached = await attachOk(task, '仕事');
    const stale = await attach(task, { name: '家' });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe(
      'VERSION_CONFLICT',
    );
    expect((await detach(task, (attached.tags[0] as TagJson).id)).status).toBe(409);
    expect((await listTags()).map((t) => t.name)).toEqual(['仕事']);
  });

  it('NFR-14 業務日が変わった画面からは、明示の指定がない限り付け外しできない（409）', async () => {
    const task = await addTask();
    now = new Date('2026-09-23T21:00:00.000Z');
    const res = await attach(task, { name: '仕事' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('DAY_CHANGED');
    expect((await attach(task, { name: '仕事', allowPastDay: true })).status).toBe(200);
  });

  it('名前と色を変えられる。大文字・小文字だけの変更は自分自身なので許す', async () => {
    const created = await send('POST', '/tags', { name: 'work', color: 'rose' });
    const tag = ((await created.json()) as { tag: TagJson }).tag;
    const res = await send('PATCH', `/tags/${tag.id}`, { name: 'Work', color: 'green' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tag: TagJson }).tag).toMatchObject({
      name: 'Work',
      color: 'green',
    });
  });

  it('ほかのタグと同じ名前には変えられない（409）。ないタグは 404', async () => {
    await send('POST', '/tags', { name: '仕事', color: 'rose' });
    const created = await send('POST', '/tags', { name: '家', color: 'rose' });
    const tag = ((await created.json()) as { tag: TagJson }).tag;
    expect((await send('PATCH', `/tags/${tag.id}`, { name: '仕事' })).status).toBe(409);
    expect((await send('PATCH', '/tags/nope', { color: 'plum' })).status).toBe(404);
  });

  it('タグを消すと、付いていたタスクからも外れる', async () => {
    const attached = await attachOk(await addTask(), '仕事');
    const tagId = (attached.tags[0] as TagJson).id;
    const res = await send('DELETE', `/tags/${tagId}`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: [] });
    expect((await backlogTask(attached.task.id))?.tags).toEqual([]);
    expect((await send('DELETE', `/tags/${tagId}`, {})).status).toBe(404);
  });

  it('トークンのない要求ではタグを作れない（403）', async () => {
    const { [TOKEN_HEADER]: _, ...withoutToken } = headers;
    const res = await app.request('/api/tags', {
      method: 'POST',
      headers: withoutToken,
      body: JSON.stringify({ name: '仕事', color: 'rose' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('FR-R08 タグごとの集計の API', () => {
  type StatJson = {
    tag: { id: string; name: string; color: string } | null;
    completed: number;
    doingDays: number;
    waitingDays: number;
  };
  const attachTag = async (task: TaskJson, name: string) => {
    const res = await send('POST', `/tasks/${task.id}/tags`, {
      name,
      expectedVersion: task.version,
      expectedDay: TODAY,
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { task: TaskJson }).task;
  };
  const advance = async (task: TaskJson, to: string) => {
    const res = await transition(task, to);
    expect(res.status).toBe(200);
    return ((await res.json()) as { task: TaskJson }).task;
  };

  it('月の応答に、タグごとの完了の数と着手中・待ちの日数を、名前の順と「タグなし」の順で含める', async () => {
    const work = await attachTag(
      await addTask({ planFor: 'today', title: '仕事のタスク' }),
      '仕事',
    );
    await advance(await advance(work, 'doing'), 'done');
    const home = await attachTag(await addTask({ planFor: 'today', title: '家のタスク' }), '家');
    await advance(await advance(home, 'doing'), 'waiting');
    await advance(await addTask({ planFor: 'today', title: 'タグなし' }), 'doing');

    const m = (await (await get('/months/2026-09')).json()) as { tagStats: StatJson[] };
    expect(m.tagStats).toEqual([
      {
        tag: expect.objectContaining({ name: '仕事' }),
        completed: 1,
        doingDays: 1,
        waitingDays: 0,
      },
      { tag: expect.objectContaining({ name: '家' }), completed: 0, doingDays: 0, waitingDays: 1 },
      { tag: null, completed: 0, doingDays: 1, waitingDays: 0 },
    ]);
  });

  it('タイムラインの応答に、表示期間のタグごとの集計を含め、まだ来ていない日は数えない', async () => {
    const task = await attachTag(await addTask({ planFor: 'today' }), '仕事');
    await advance(task, 'doing');
    const res = await get(`/timeline?from=${TODAY}&to=2026-09-29`);
    const body = (await res.json()) as { tagStats: StatJson[] };
    expect(body.tagStats).toEqual([
      {
        tag: expect.objectContaining({ name: '仕事' }),
        completed: 0,
        doingDays: 1,
        waitingDays: 0,
      },
    ]);
  });

  it('まだ始まっていない月は空', async () => {
    const m = (await (await get('/months/2026-10')).json()) as { tagStats: StatJson[] };
    expect(m.tagStats).toEqual([]);
  });
});
