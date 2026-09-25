import { createFakeAgentRunner, FAKE_OUTPUT, type FakeMode } from '@mymind/agent';
import {
  createJobRepository,
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
