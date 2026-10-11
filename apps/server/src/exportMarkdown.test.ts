import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeAgentRunner } from '@mymind/agent';
import {
  createDailyLogRepository,
  createDailyRecordRepository,
  createJobRepository,
  createSettingsRepository,
  createTagRepository,
  createTaskRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { toBusinessDay } from '@mymind/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from './api';
import { createEventBus } from './events';
import {
  collectExportDays,
  type ExportDay,
  type ExportDeps,
  isEmptyExportDay,
  renderDayMarkdown,
  writeExport,
} from './exportMarkdown';
import { createJobRunner } from './jobRunner';

const DAY = '2026-09-23';

const feedbackContent = {
  condition: { level: 3, reason: '設計に集中できた' },
  good: ['スキーマを決めきった'],
  insight: ['先に画面を並べると早い'],
  next_action: '朝いちばんにルーティングを書く',
};

const full: ExportDay = {
  day: DAY,
  completed: ['経費精算', 'D1のスキーマ設計'],
  reflection: { thoughtsMd: '# 考えたこと\n\n- 論点が多い', learningMd: '型を先に決める' },
  feedback: { content: feedbackContent, agent: 'claude', createdAt: '2026-09-23T12:00:00.000Z' },
  condition: { userLevel: 1, aiLevel: 3 },
};

const empty: ExportDay = {
  day: DAY,
  completed: [],
  reflection: null,
  feedback: null,
  condition: null,
};

describe('FR-R09 1日分を Markdown にする', () => {
  it('完了したタスク、振り返り、FB、調子を、アプリなしで読める形に書く', () => {
    expect(renderDayMarkdown(full)).toBe(
      [
        '# 2026-09-23',
        '調子：不調（手で直した値。AI の判定は好調）',
        '## 完了したタスク\n\n- 経費精算\n- D1のスキーマ設計',
        '## 思考の整理\n\n# 考えたこと\n\n- 論点が多い',
        '## 学び\n\n型を先に決める',
        '## フィードバック\n\nclaude、2026-09-23T12:00:00.000Z',
        '### よかったこと\n\n- スキーマを決めきった',
        '### 気づき\n\n- 先に画面を並べると早い',
        '### 明日の一手\n\n朝いちばんにルーティングを書く',
        '### 調子の判定\n\n好調：設計に集中できた\n',
      ].join('\n\n'),
    );
  });

  it('ない項目の見出しは出さない', () => {
    const md = renderDayMarkdown({ ...empty, completed: ['経費精算'] });
    expect(md).toBe('# 2026-09-23\n\n## 完了したタスク\n\n- 経費精算\n');
  });

  it('振り返りの片方だけを書いた日は、書いた方だけを出す', () => {
    const md = renderDayMarkdown({ ...empty, reflection: { thoughtsMd: '', learningMd: '学び' } });
    expect(md).toContain('## 学び');
    expect(md).not.toContain('## 思考の整理');
  });

  it('気づきのない FB は、気づきの見出しを出さない', () => {
    const md = renderDayMarkdown({
      ...empty,
      feedback: {
        ...full.feedback,
        content: { ...feedbackContent, insight: [] },
      } as ExportDay['feedback'],
    });
    expect(md).not.toContain('### 気づき');
  });

  it('調子は、手で付けた値、AI の判定だけ、の書き方を分ける', () => {
    const line = (condition: ExportDay['condition']) =>
      renderDayMarkdown({ ...empty, condition }).split('\n')[2];
    expect(line({ userLevel: 4, aiLevel: null })).toBe('調子：絶好調（手で付けた値）');
    expect(line({ userLevel: 2, aiLevel: 2 })).toBe('調子：普通（手で付けた値）');
    expect(line({ userLevel: null, aiLevel: 0 })).toBe('調子：絶不調（AI の判定）');
  });

  it('書き出すものがない日を見分ける', () => {
    expect(isEmptyExportDay(empty)).toBe(true);
    expect(isEmptyExportDay({ ...empty, condition: { userLevel: null, aiLevel: null } })).toBe(
      true,
    );
    expect(isEmptyExportDay({ ...empty, completed: ['経費精算'] })).toBe(false);
  });
});

describe('FR-R09 書き出す日を集める', () => {
  const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };
  let deps: ExportDeps;
  let api: ReturnType<typeof createApi>;
  let runner: ReturnType<typeof createJobRunner>;
  /** 2026-09-22 10:00（日本時間）から始める */
  let now = new Date('2026-09-22T01:00:00.000Z');

  beforeEach(() => {
    now = new Date('2026-09-22T01:00:00.000Z');
    const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
    let seq = 0;
    const newId = () => `id${String(++seq).padStart(5, '0')}`;
    const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
    const jobs = createJobRepository({ db, codec: plainCodec });
    const logs = createDailyLogRepository({ db, codec: plainCodec });
    const tags = createTagRepository({ db });
    const records = createDailyRecordRepository({ db, codec: plainCodec });
    const events = createEventBus();
    const fake = createFakeAgentRunner();
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
    deps = { tasks, logs, jobs };
  });

  const today = () => toBusinessDay(now, DAY_OPTIONS);
  const send = async (method: string, path: string, body: unknown) => {
    const res = await api.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.ok, `${method} ${path}`).toBe(true);
    return (await res.json()) as { task: { id: string; version: number } };
  };
  /** 今日の計画にタスクを作り、順に状態を変える */
  const addTask = async (title: string, ...steps: string[]) => {
    let { task } = await send('POST', '/tasks', { title, expectedDay: today(), planFor: 'today' });
    for (const to of steps) {
      ({ task } = await send('POST', `/tasks/${task.id}/transition`, {
        to,
        expectedVersion: task.version,
        expectedDay: today(),
      }));
    }
  };

  it('完了・振り返り・調子のどれかがある日を、古い順に集める', async () => {
    await addTask('経費精算', 'doing', 'done');
    now = new Date('2026-09-23T01:00:00.000Z');
    await send('PUT', `/days/${DAY}/log`, { thoughtsMd: '考えたこと', learningMd: '' });
    now = new Date('2026-09-24T01:00:00.000Z');
    await send('PUT', '/days/2026-09-24/condition', { userLevel: 4 });

    const days = collectExportDays(deps);

    expect(days.map((d) => d.day)).toEqual(['2026-09-22', DAY, '2026-09-24']);
    expect(days[0]).toMatchObject({ completed: ['経費精算'], reflection: null });
    expect(days[1]?.reflection).toEqual({ thoughtsMd: '考えたこと', learningMd: '' });
    expect(days[2]?.condition).toEqual({ userLevel: 4, aiLevel: null });
  });

  it('計画に入れずに完了したタスクだけがある日も集める', async () => {
    // バックログに作って、そのまま着手して完了にする（計画・振り返り・FB・調子はない）
    let { task } = await send('POST', '/tasks', { title: '歯医者の予約', expectedDay: today() });
    for (const to of ['doing', 'done']) {
      ({ task } = await send('POST', `/tasks/${task.id}/transition`, {
        to,
        expectedVersion: task.version,
        expectedDay: today(),
      }));
    }
    expect(collectExportDays(deps)).toMatchObject([
      { day: '2026-09-22', completed: ['歯医者の予約'] },
    ]);
  });

  it('完了を取り消したタスクは、その日の完了に入れない', async () => {
    await addTask('経費精算', 'doing', 'done', 'doing');
    expect(collectExportDays(deps)).toEqual([]);
  });

  it('計画はあるが、完了も振り返りも FB もない日は集めない', async () => {
    await addTask('企画書', 'doing');
    expect(collectExportDays(deps)).toEqual([]);
  });

  it('前の日に完了したタスクは、後の日の完了に入れない', async () => {
    await addTask('経費精算', 'doing', 'done');
    now = new Date('2026-09-23T01:00:00.000Z');
    await send('PUT', `/days/${DAY}/log`, { thoughtsMd: '考えたこと', learningMd: '' });

    const days = collectExportDays(deps);
    expect(days.find((d) => d.day === DAY)?.completed).toEqual([]);
  });

  it('日次 FB をもらった日は、最新の FB と AI の調子を入れる', async () => {
    await addTask('企画書', 'doing');
    await send('POST', '/jobs', { kind: 'daily_feedback', period: today() });
    await runner.idle();

    const [day] = collectExportDays(deps);
    expect(day?.day).toBe('2026-09-22');
    expect(day?.feedback?.content.good.length).toBeGreaterThan(0);
    expect(day?.condition).toEqual({ userLevel: null, aiLevel: 3 });
  });
});

describe('FR-R09 NFR-16 ファイルに書く', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mymind-export-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const mode = (path: string) => statSync(path).mode & 0o777;

  it('日ごとに YYYY-MM-DD.md を、本人だけが読める権限で書く', () => {
    const dir = join(root, 'out');
    const written = writeExport(dir, [full, { ...full, day: '2026-09-24' }]);

    expect(written).toEqual([join(dir, '2026-09-23.md'), join(dir, '2026-09-24.md')]);
    expect(readdirSync(dir).sort()).toEqual(['2026-09-23.md', '2026-09-24.md']);
    expect(readFileSync(join(dir, '2026-09-23.md'), 'utf8')).toBe(renderDayMarkdown(full));
    expect(mode(join(dir, '2026-09-23.md'))).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
  });

  it('既にあるディレクトリの権限は変えない', () => {
    chmodSync(root, 0o755);
    writeExport(root, [full]);
    expect(mode(root)).toBe(0o755);
  });

  it('書き出し先のファイルがシンボリックリンクでも、リンク先は書き換えない', () => {
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, '書き換えてはいけない', { mode: 0o644 });
    const dir = join(root, 'out');
    mkdirSync(dir);
    symlinkSync(outside, join(dir, '2026-09-23.md'));

    writeExport(dir, [full]);

    expect(readFileSync(outside, 'utf8')).toBe('書き換えてはいけない');
    expect(mode(outside)).toBe(0o644);
    expect(lstatSync(join(dir, '2026-09-23.md')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, '2026-09-23.md'), 'utf8')).toBe(renderDayMarkdown(full));
  });

  it('一時ファイルを残さない', () => {
    writeExport(root, [full]);
    expect(readdirSync(root)).toEqual(['2026-09-23.md']);
  });

  it('書き出し直すと同じ名前のファイルを上書きし、権限も 600 にそろえる', () => {
    const [path] = writeExport(root, [full]);
    chmodSync(path ?? '', 0o644);
    writeExport(root, [{ ...full, completed: ['書き直した'] }]);
    expect(readFileSync(path ?? '', 'utf8')).toContain('- 書き直した');
    expect(mode(path ?? '')).toBe(0o600);
  });
});
