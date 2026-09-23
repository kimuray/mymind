import { createTaskRepository, MIGRATIONS_FOLDER, openDatabase, plainCodec } from '@mymind/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api';
import { createApp } from './app';
import { TOKEN_HEADER } from './security';

const PORT = 4820;
const TOKEN = 'token';
const TODAY = '2026-09-23';
const TOMORROW = '2026-09-24';

/** 2026-09-23 10:00（日本時間） */
let now = new Date('2026-09-23T01:00:00.000Z');
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  now = new Date('2026-09-23T01:00:00.000Z');
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  let seq = 0;
  const newId = () => `id${String(++seq).padStart(5, '0')}`;
  const api = createApi({
    tasks: createTaskRepository({ db, codec: plainCodec, newEventId: newId }),
    now: () => now,
    dayOptions: { timeZone: 'Asia/Tokyo', dayStartHour: 5 },
    newId,
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
