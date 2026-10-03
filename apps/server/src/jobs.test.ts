import { createFakeAgentRunner, FAKE_OUTPUT, type FakeMode } from '@mymind/agent';
import {
  createDailyLogRepository,
  createJobRepository,
  createSettingsRepository,
  createTaskRepository,
  type Database,
  type JobRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentLogRecord } from './agentLog';
import { createApi } from './api';
import { createApp } from './app';
import { createEventBus, type ServerEvent } from './events';
import { createJobRunner } from './jobRunner';
import { createLogger } from './logger';
import { TOKEN_HEADER } from './security';

const PORT = 4820;
const DAY = '2026-09-23';
const now = new Date('2026-09-23T12:00:00.000Z');

let db: Database;
let jobs: JobRepository;
let seq: number;
let published: ServerEvent[];

beforeEach(() => {
  db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  jobs = createJobRepository({ db, codec: plainCodec });
  seq = 0;
  published = [];
});

const newId = () => `id${String(++seq).padStart(5, '0')}`;

function setup(mode: FakeMode = 'success', timeoutMs = 1000) {
  const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
  const events = createEventBus();
  events.subscribe((e) => published.push(e.event));
  const agent = createFakeAgentRunner({ mode });
  const runner = createJobRunner({
    jobs,
    tasks,
    logs: createDailyLogRepository({ db, codec: plainCodec }),
    runner: agent,
    events,
    prompt: { text: '<!-- prompt_version: 0.1.0 -->\nプロンプト', version: '0.1.0' },
    now: () => now,
    newId,
    timeoutMs,
  });
  const app = createApp(
    { ports: [PORT], sessionToken: 'token' },
    createApi({
      tasks,
      now: () => now,
      dayOptions: { timeZone: 'Asia/Tokyo', dayStartHour: 5 },
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
      logs: createDailyLogRepository({ db, codec: plainCodec }),
    }),
  );
  return { runner, agent, tasks, events, app };
}

const statuses = (jobId: string) =>
  published.filter((e) => e.job.id === jobId).map((e) => e.job.status);

describe('FR-A01 FB の依頼と生成', () => {
  it('依頼すると待機中で登録され、生成中を経て完了し、FB と調子を保存する', async () => {
    const { runner } = setup();
    const { job } = runner.enqueue('daily_feedback', DAY);
    expect(job.status).toBe('queued');
    await runner.idle();
    expect(jobs.find(job.id)?.status).toBe('succeeded');
    expect(statuses(job.id)).toEqual(['queued', 'running', 'succeeded']);
    expect(jobs.listFeedbacks('daily', DAY)).toMatchObject([
      { content: FAKE_OUTPUT, agent: 'fake', promptVersion: '0.1.0', jobId: job.id },
    ]);
    expect(jobs.findCondition(DAY)).toMatchObject({
      aiLevel: FAKE_OUTPUT.condition.level,
      aiReason: FAKE_OUTPUT.condition.reason,
    });
  });

  it('同じ日のジョブがまだ終わっていなければ、新しく作らずにそれを返す', () => {
    const { runner } = setup('hang');
    const first = runner.enqueue('daily_feedback', DAY);
    const second = runner.enqueue('daily_feedback', DAY);
    expect(second).toEqual({ job: expect.objectContaining({ id: first.job.id }), created: false });
    runner.cancel(first.job.id);
  });

  it('その日の計画を、件数を数えてから入力に入れる（FR-A10）', async () => {
    const { runner, agent, tasks } = setup();
    tasks.create({
      created: { type: 'created', taskId: 't1', at: now.toISOString(), day: DAY },
      parentId: null,
      title: '企画書を書く',
      noteMd: null,
      plan: { day: DAY, event: { type: 'planned', taskId: 't1', at: now.toISOString(), day: DAY } },
    });
    runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    const input = agent.inputs[0] ?? '';
    expect(input).toContain('<data>');
    expect(input).toContain('"planned": 1');
    expect(input).toContain('企画書を書く');
  });
});

describe('FR-A08 失敗とキャンセル', () => {
  it('形式違反の出力は1回だけ再試行し、2回目が正しければ完了にする', async () => {
    const { runner, agent } = setup('invalid-once');
    const { job } = runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    expect(agent.inputs).toHaveLength(2);
    expect(jobs.find(job.id)?.status).toBe('succeeded');
  });

  it('再試行しても形式が違えば、理由を付けて失敗にする', async () => {
    const { runner, agent } = setup('invalid');
    const { job } = runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    expect(agent.inputs).toHaveLength(2);
    expect(jobs.find(job.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('形式が正しくありませんでした'),
    });
    expect(jobs.listFeedbacks('daily', DAY)).toEqual([]);
  });

  it('時間内に応答がなければ、タイムアウトとして失敗にする', async () => {
    const { runner } = setup('hang', 20);
    const { job } = runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    expect(jobs.find(job.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('応答がなかった'),
    });
  });

  it('生成中にキャンセルすると、エージェントを止めてキャンセルにする', async () => {
    const { runner } = setup('hang');
    const { job } = runner.enqueue('daily_feedback', DAY);
    await Promise.resolve();
    expect(jobs.find(job.id)?.status).toBe('running');
    expect(runner.cancel(job.id)).toMatchObject({ ok: true, job: { status: 'cancelled' } });
    await runner.idle();
    expect(jobs.find(job.id)?.status).toBe('cancelled');
    expect(jobs.listFeedbacks('daily', DAY)).toEqual([]);
  });

  it('待機中のジョブもキャンセルでき、実行されない', async () => {
    const { runner, agent } = setup('hang');
    const running = runner.enqueue('daily_feedback', DAY).job;
    const queued = runner.enqueue('daily_feedback', '2026-09-22').job;
    expect(runner.cancel(queued.id)).toMatchObject({ ok: true });
    runner.cancel(running.id);
    await runner.idle();
    expect(agent.inputs).toHaveLength(1);
    expect(jobs.find(queued.id)?.status).toBe('cancelled');
  });

  it('終わったジョブはキャンセルできない', async () => {
    const { runner } = setup();
    const { job } = runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    expect(runner.cancel(job.id)).toEqual({ ok: false, reason: 'finished' });
  });

  it('起動時に、前回の停止で実行中のまま残ったジョブを失敗にする（architecture.md 7.6）', () => {
    jobs.create({
      id: 'old',
      kind: 'daily_feedback',
      period: DAY,
      agent: 'fake',
      createdAt: now.toISOString(),
    });
    jobs.claimNext(now.toISOString());
    const { runner } = setup();
    runner.start();
    expect(jobs.find('old')).toMatchObject({
      status: 'failed',
      error: 'サーバーの停止で中断しました',
    });
    expect(statuses('old')).toEqual(['failed']);
  });
});

describe('FR-A01 ジョブと FB の API', () => {
  const headers = {
    Host: `127.0.0.1:${PORT}`,
    'Sec-Fetch-Site': 'same-origin',
    Origin: `http://127.0.0.1:${PORT}`,
    [TOKEN_HEADER]: 'token',
    'Content-Type': 'application/json',
  };

  it('POST /api/jobs は 202 でジョブを返し、完了後に FB を取得できる', async () => {
    const { app, runner } = setup();
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'daily_feedback', period: DAY }),
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: { id: string; status: string } };
    expect(job.status).toBe('queued');
    await runner.idle();
    const got = await app.request(`/api/jobs/${job.id}`, { headers });
    expect(await got.json()).toMatchObject({ job: { status: 'succeeded' } });
    const fb = await app.request(`/api/feedbacks?scope=daily&period=${DAY}`, { headers });
    expect(await fb.json()).toMatchObject({ feedbacks: [{ content: FAKE_OUTPUT }] });
  });

  it('POST /api/jobs/:id/cancel でキャンセルし、終わったジョブは 409', async () => {
    const { app, runner } = setup('hang');
    const { job } = runner.enqueue('daily_feedback', DAY);
    const res = await app.request(`/api/jobs/${job.id}/cancel`, { method: 'POST', headers });
    expect(await res.json()).toMatchObject({ job: { status: 'cancelled' } });
    await runner.idle();
    const again = await app.request(`/api/jobs/${job.id}/cancel`, { method: 'POST', headers });
    expect(again.status).toBe(409);
  });

  it.each([
    ['種類が不正', { kind: 'weekly', period: DAY }],
    ['期間の形式が不正', { kind: 'daily_feedback', period: '9/23' }],
  ])('%s なら 400', async (_, body) => {
    const { app } = setup();
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('存在しないジョブは 404', async () => {
    const { app } = setup();
    expect((await app.request('/api/jobs/missing', { headers })).status).toBe(404);
    expect(
      (await app.request('/api/jobs/missing/cancel', { method: 'POST', headers })).status,
    ).toBe(404);
  });

  it('トークンのない依頼は 403（エージェントを起動できる API を守る）', async () => {
    const { app } = setup();
    const { [TOKEN_HEADER]: _, ...noToken } = headers;
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: noToken,
      body: JSON.stringify({ kind: 'daily_feedback', period: DAY }),
    });
    expect(res.status).toBe(403);
  });
});

describe('ADR-0008 GET /api/events', () => {
  it('ジョブの進み具合を SSE で配信する', async () => {
    const { app, runner } = setup();
    const res = await app.request('/api/events', { headers: { Host: `127.0.0.1:${PORT}` } });
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error('本文がありません');

    runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    let text = '';
    while (!text.includes('"status":"succeeded"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(text).toContain('event: job.updated');
    expect(text).toContain('"status":"running"');
    expect(text).toContain('"status":"succeeded"');
  });
});

describe('ADR-0008 再接続のときの取りこぼしの補完', () => {
  it('Last-Event-ID より後の出来事を、先に送り直す', async () => {
    const { app, runner } = setup();
    const first = runner.enqueue('daily_feedback', DAY).job;
    await runner.idle();
    const second = runner.enqueue('daily_feedback', '2026-09-22').job;
    await runner.idle();
    // 1件目のジョブの出来事（queued・running・succeeded）までは受け取っていた
    const res = await app.request('/api/events', {
      headers: { Host: `127.0.0.1:${PORT}`, 'Last-Event-ID': '3' },
    });
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error('本文がありません');
    let text = '';
    while (
      !text.includes(
        `"id":"${second.id}","kind":"daily_feedback","period":"2026-09-22","agent":"fake","status":"succeeded"`,
      )
    ) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(text).toContain('id: 4');
    expect(text).not.toContain('id: 3\n');
    expect(text).not.toContain(first.id);
  });
});

describe('NFR-16 エージェントの入出力のログ', () => {
  it('入力と各回の出力を、ジョブごとにローカルのログへ残し、ロガーには本文を出さない', async () => {
    const written: {
      day: string;
      record: { input: string; attempts: unknown[]; status: string };
    }[] = [];
    const lines: string[] = [];
    const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
    const runner = createJobRunner({
      jobs,
      tasks,
      logs: createDailyLogRepository({ db, codec: plainCodec }),
      runner: createFakeAgentRunner({ mode: 'invalid' }),
      events: createEventBus(),
      prompt: { text: 'プロンプト', version: '0.1.0' },
      now: () => now,
      newId,
      timeoutMs: 1000,
      agentLog: {
        write: (day, record) => {
          written.push({ day, record });
          return '';
        },
        prune: () => [],
      },
      logger: createLogger({ write: (line) => lines.push(line) }),
    });
    runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ day: DAY, record: { status: 'failed' } });
    expect(written[0]?.record.input).toContain('<data>');
    expect(written[0]?.record.attempts).toHaveLength(2);
    expect(lines.join('\n')).toContain('FB の生成に失敗しました');
    expect(lines.join('\n')).not.toContain('<data>');
    expect(lines.join('\n')).not.toContain('JSON ではない出力');
  });
});

describe('NFR-15 日次 FB に送る入力', () => {
  it('直近7日の調子と明日の一手を添え、送った入力の文字数と注記をログに残す', async () => {
    const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
    const inputs: string[] = [];
    const logged: AgentLogRecord[] = [];
    const runner = createJobRunner({
      jobs,
      tasks,
      logs: createDailyLogRepository({ db, codec: plainCodec }),
      runner: {
        name: 'fake',
        run: async (input) => {
          inputs.push(input);
          return { ok: true, output: JSON.stringify(FAKE_OUTPUT) };
        },
      },
      events: createEventBus(),
      prompt: { text: 'プロンプト', version: '0.1.0' },
      now: () => now,
      newId,
      timeoutMs: 1000,
      agentLog: {
        write: (_day, record) => {
          logged.push(record);
          return '';
        },
        prune: () => [],
      },
    });
    // 前日の FB（調子と明日の一手）を先に作る
    runner.enqueue('daily_feedback', '2026-09-22');
    await runner.idle();
    runner.enqueue('daily_feedback', DAY);
    await runner.idle();

    const last = inputs.at(-1) ?? '';
    const payload = JSON.parse(
      last.slice(last.indexOf('<data>\n') + 7, last.lastIndexOf('\n</data>')),
    );
    expect(payload.recent).toHaveLength(7);
    expect(payload.recent[0]).toEqual({
      day: '2026-09-22',
      condition: FAKE_OUTPUT.condition.level,
      next_action: FAKE_OUTPUT.next_action,
      blank: false,
    });
    expect(payload.recent[1]).toEqual({
      day: '2026-09-21',
      condition: null,
      next_action: null,
      blank: true,
    });
    expect(logged.at(-1)).toMatchObject({ annotations: [], charCount: expect.any(Number) });
  });
});

describe('FR-A12 送信内容のプレビュー', () => {
  const headers = {
    Host: `127.0.0.1:${PORT}`,
    'Sec-Fetch-Site': 'same-origin',
    Origin: `http://127.0.0.1:${PORT}`,
    [TOKEN_HEADER]: 'token',
    'Content-Type': 'application/json',
  };
  type Preview = {
    payload: { tasks: { title: string }[] };
    annotations: unknown[];
    charCount: number;
    payloadHash: string;
  };

  const post = (app: ReturnType<typeof setup>['app'], path: string, body: unknown) =>
    app.request(`/api${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

  const addPlannedTask = (tasks: ReturnType<typeof setup>['tasks'], id: string, title: string) =>
    tasks.create({
      created: { type: 'created', taskId: id, at: now.toISOString(), day: DAY },
      parentId: null,
      title,
      noteMd: null,
      plan: { day: DAY, event: { type: 'planned', taskId: id, at: now.toISOString(), day: DAY } },
    });

  const preview = async (app: ReturnType<typeof setup>['app']) => {
    const res = await post(app, '/agent-input/preview', { kind: 'daily_feedback', period: DAY });
    expect(res.status).toBe(200);
    return (await res.json()) as Preview;
  };

  it('実際に送る入力、注記、文字数、ハッシュを返し、プロンプトの全文は返さない', async () => {
    const { app, tasks } = setup();
    addPlannedTask(tasks, 't1', '企画書を書く');
    const body = await preview(app);
    expect(body.payload.tasks.map((t) => t.title)).toEqual(['企画書を書く']);
    expect(body.annotations).toEqual([]);
    expect(body.charCount).toBe(JSON.stringify(body.payload, null, 2).length);
    expect(body.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.keys(body).sort()).toEqual([
      'annotations',
      'charCount',
      'payload',
      'payloadHash',
    ]);
  });

  it('プレビューの payload は、エージェントが受け取った <data> の中身と一致する', async () => {
    const { app, tasks, runner, agent } = setup();
    addPlannedTask(tasks, 't1', '企画書を書く');
    const shown = await preview(app);
    const res = await post(app, '/jobs', {
      kind: 'daily_feedback',
      period: DAY,
      payloadHash: shown.payloadHash,
    });
    expect(res.status).toBe(202);
    await runner.idle();
    const sent = agent.inputs[0] ?? '';
    expect(
      JSON.parse(sent.slice(sent.indexOf('<data>\n') + 7, sent.lastIndexOf('\n</data>'))),
    ).toEqual(shown.payload);
  });

  it('プレビューの後に送る内容が変わっていたら、409（PREVIEW_STALE）で依頼しない', async () => {
    const { app, tasks } = setup();
    addPlannedTask(tasks, 't1', '企画書を書く');
    const shown = await preview(app);
    addPlannedTask(tasks, 't2', '週報を書く');
    const res = await post(app, '/jobs', {
      kind: 'daily_feedback',
      period: DAY,
      payloadHash: shown.payloadHash,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'PREVIEW_STALE' } });
    expect(jobs.findActive('daily_feedback', DAY)).toBeUndefined();
  });

  it('ハッシュを付けない依頼は、これまでどおり確認なしで受け付ける', async () => {
    const { app } = setup();
    const res = await post(app, '/jobs', { kind: 'daily_feedback', period: DAY });
    expect(res.status).toBe(202);
  });

  it.each([
    [
      'プレビューの期間の形式が不正',
      '/agent-input/preview',
      { kind: 'daily_feedback', period: '9/23' },
    ],
    [
      'プレビューに余計な項目',
      '/agent-input/preview',
      { kind: 'daily_feedback', period: DAY, x: 1 },
    ],
    ['ハッシュの形式が不正', '/jobs', { kind: 'daily_feedback', period: DAY, payloadHash: 'abc' }],
  ])('%s なら 400', async (_, path, body) => {
    const { app } = setup();
    expect((await post(app, path, body)).status).toBe(400);
  });

  it('トークンのないプレビューは 403', async () => {
    const { app } = setup();
    const { [TOKEN_HEADER]: _, ...noToken } = headers;
    const res = await app.request('/api/agent-input/preview', {
      method: 'POST',
      headers: noToken,
      body: JSON.stringify({ kind: 'daily_feedback', period: DAY }),
    });
    expect(res.status).toBe(403);
  });
});

describe('FR-D06 日次 FB に送る振り返り', () => {
  const headers = {
    Host: `127.0.0.1:${PORT}`,
    'Sec-Fetch-Site': 'same-origin',
    Origin: `http://127.0.0.1:${PORT}`,
    [TOKEN_HEADER]: 'token',
    'Content-Type': 'application/json',
  };
  type Payload = {
    reflection?: { thoughts_md: string; learning_md: string };
    recent: { day: string; blank: boolean }[];
  };

  const previewPayload = async (app: ReturnType<typeof setup>['app']) => {
    const res = await app.request('/api/agent-input/preview', {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'daily_feedback', period: DAY }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { payload: Payload }).payload;
  };
  const saveLog = (app: ReturnType<typeof setup>['app'], day: string, thoughtsMd: string) =>
    app.request(`/api/days/${day}/log`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ thoughtsMd, learningMd: '' }),
    });

  it('保存した振り返りを入力に含める', async () => {
    const { app } = setup();
    expect((await saveLog(app, DAY, '企画書が進んだ')).status).toBe(200);
    expect((await previewPayload(app)).reflection).toEqual({
      thoughts_md: '企画書が進んだ',
      learning_md: '',
    });
  });

  it('振り返りがない日や、どちらの欄も空の日は、振り返りを送らない', async () => {
    const { app } = setup();
    expect((await previewPayload(app)).reflection).toBeUndefined();
    await saveLog(app, DAY, '  ');
    expect((await previewPayload(app)).reflection).toBeUndefined();
  });

  it('振り返りだけを保存した直近の日は、空白日として扱わない', async () => {
    const { app } = setup();
    await saveLog(app, '2026-09-21', '一行だけ');
    const recent = (await previewPayload(app)).recent;
    expect(recent.find((r) => r.day === '2026-09-21')?.blank).toBe(false);
    expect(recent.find((r) => r.day === '2026-09-20')?.blank).toBe(true);
  });
});

describe('FR-A03 FR-A04 FR-D02 その日の FB と調子、前日の FB', () => {
  const headers = {
    Host: `127.0.0.1:${PORT}`,
    'Sec-Fetch-Site': 'same-origin',
    Origin: `http://127.0.0.1:${PORT}`,
    [TOKEN_HEADER]: 'token',
    'Content-Type': 'application/json',
  };
  type DayJson = {
    feedback: { id: string; content: { next_action: string } | null } | null;
    condition: { aiLevel: number | null; userLevel: number | null } | null;
    job: { status: string } | null;
    previous: { day: string; feedback: { id: string } | null } | null;
  };
  const getDay = async (app: ReturnType<typeof setup>['app'], day: string) =>
    (await (await app.request(`/api/days/${day}`, { headers })).json()) as DayJson;
  const putCondition = (
    app: ReturnType<typeof setup>['app'],
    day: string,
    userLevel: number | null,
  ) =>
    app.request(`/api/days/${day}/condition`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ userLevel }),
    });

  it('FB をもらっていない日は、FB も調子もジョブも null', async () => {
    const { app } = setup();
    expect(await getDay(app, DAY)).toMatchObject({
      feedback: null,
      condition: null,
      job: null,
      previous: null,
    });
  });

  it('FB をもらうと、検証した中身と AI の調子、完了したジョブを返し、再依頼すると最新を返す', async () => {
    const { app, runner } = setup();
    runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    const first = await getDay(app, DAY);
    expect(first.feedback?.content?.next_action).toBe(FAKE_OUTPUT.next_action);
    expect(first.condition).toMatchObject({
      aiLevel: FAKE_OUTPUT.condition.level,
      userLevel: null,
    });
    expect(first.job).toMatchObject({ status: 'succeeded' });

    runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    const second = await getDay(app, DAY);
    expect(second.feedback?.id).not.toBe(first.feedback?.id);
  });

  it('失敗したジョブは、その日の最新のジョブとして返す', async () => {
    const { app, runner } = setup('invalid');
    runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    expect(await getDay(app, DAY)).toMatchObject({ feedback: null, job: { status: 'failed' } });
  });

  it('前日の FB は、空白日をはさんでも最後にもらった日のもの', async () => {
    const { app, runner } = setup();
    runner.enqueue('daily_feedback', '2026-09-20');
    await runner.idle();
    expect((await getDay(app, DAY)).previous).toMatchObject({
      day: '2026-09-20',
      feedback: { id: expect.any(String) },
    });
  });

  it('調子を手で直すと、AI の値と手動の値の両方が残り、null で手動の値を外せる', async () => {
    const { app, runner } = setup();
    runner.enqueue('daily_feedback', DAY);
    await runner.idle();
    expect((await putCondition(app, DAY, 0)).status).toBe(200);
    expect((await getDay(app, DAY)).condition).toMatchObject({
      aiLevel: FAKE_OUTPUT.condition.level,
      userLevel: 0,
    });
    await putCondition(app, DAY, null);
    expect((await getDay(app, DAY)).condition).toMatchObject({ userLevel: null });
  });

  it('範囲外の値、まだ来ていない日、トークンのない変更は拒否する', async () => {
    const { app } = setup();
    expect((await putCondition(app, DAY, 5)).status).toBe(400);
    expect((await putCondition(app, '2026-09-24', 2)).status).toBe(400);
    const { [TOKEN_HEADER]: _, ...noToken } = headers;
    const res = await app.request(`/api/days/${DAY}/condition`, {
      method: 'PUT',
      headers: noToken,
      body: JSON.stringify({ userLevel: 2 }),
    });
    expect(res.status).toBe(403);
  });
});
