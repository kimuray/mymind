import { relative, resolve } from 'node:path';
import { createFakeAgentRunner } from '@mymind/agent';
import {
  createDailyLogRepository,
  createJobRepository,
  createSettingsRepository,
  createTagRepository,
  createTaskRepository,
  type Database,
  plainCodec,
} from '@mymind/db';
import { type BusinessDayOptions, type CarryoverDecision, toBusinessDay } from '@mymind/domain';
import { createApi } from './api';
import { databasePath } from './backups';
import { createEventBus } from './events';
import { createJobRunner } from './jobRunner';
import { createUlidGenerator } from './ulid';

// 開発用のシードデータ（issue 017）。タイムラインやカレンダーを、空の DB でなく2週間分の記録で確かめるために使う。
// 状態の変更は、サーバーと同じ API を、時計を1日ずつ進めながら呼んで作る。そのため、すべて domain の関数を通る（ADR-0004）

/** シードで作る日数（今日を含む） */
export const SEED_DAYS = 14;
/** 計画も振り返りもない日（今日から何日前か）。2日続けてアプリを開かなかったことにする（architecture.md 4.5） */
export const BLANK_OFFSETS = [8, 7] as const;
/** FB の調子（偽のエージェントは 3）を、手で 1 に直した日（今日から何日前か、FR-A03） */
export const MANUAL_CONDITION_OFFSET = 3;
/** 振り返りは書いたが、FB を依頼しなかった日（今日から何日前か） */
export const NO_FEEDBACK_OFFSET = 1;

type TaskJson = { id: string; title: string; version: number; status: string };

/** 業務日の日付を ISO の日付どうしで足し引きする（Asia/Tokyo では夏時間がないので、日の長さは一定） */
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** 日本時間のその日の時刻 */
function at(day: string, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00.000+09:00`);
}

/**
 * シードを入れる。db はマイグレーション済みで空のもの。
 * 今日（now の業務日）を最終日として、SEED_DAYS 日分の操作を古い日から順に行う
 */
export async function seedDatabase({
  db,
  now: realNow,
  dayOptions,
}: {
  db: Database;
  now: Date;
  dayOptions: BusinessDayOptions;
}): Promise<{ from: string; to: string }> {
  let clock = realNow;
  const now = () => clock;
  const newId = createUlidGenerator(() => clock.getTime());
  const tasks = createTaskRepository({ db, codec: plainCodec, newEventId: newId });
  const jobs = createJobRepository({ db, codec: plainCodec });
  const logs = createDailyLogRepository({ db, codec: plainCodec });
  const tags = createTagRepository({ db });
  const events = createEventBus();
  const fake = createFakeAgentRunner();
  const runner = createJobRunner({
    jobs,
    tasks,
    logs,
    tags,
    runners: { claude: fake, codex: fake },
    defaultAgent: () => 'claude',
    events,
    prompt: { text: 'シード用のプロンプト', version: 'seed' },
    monthlyPrompt: { text: 'シード用のプロンプト', version: 'seed' },
    now,
    today: () => toBusinessDay(now(), dayOptions),
    newId,
    timeoutMs: 10_000,
  });
  const api = createApi({
    tasks,
    now,
    dayOptions,
    newId,
    jobs: { runner, jobs, events },
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

  const today = toBusinessDay(realNow, dayOptions);
  let day = today;
  const byTitle = new Map<string, TaskJson>();

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await api.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const remember = (list: unknown) => {
    for (const t of list as TaskJson[]) byTitle.set(t.title, t);
  };
  const task = (title: string) => {
    const t = byTitle.get(title);
    if (t === undefined) throw new Error(`シードのタスクがありません: ${title}`);
    return t;
  };
  /** 計画とバックログを読み直す（計画の確定や持ち越しで版が変わるため） */
  const refresh = async () => {
    remember((await call('GET', `/days/${day}`))['tasks']);
    remember((await call('GET', '/backlog'))['tasks']);
  };
  const add = async (
    title: string,
    options: { parent?: string; planFor?: 'today'; tag?: string } = {},
  ) => {
    const created = (
      await call('POST', '/tasks', {
        title,
        expectedDay: day,
        ...(options.parent === undefined ? {} : { parentId: task(options.parent).id }),
        ...(options.planFor === undefined ? {} : { planFor: options.planFor }),
      })
    )['task'] as TaskJson;
    byTitle.set(title, created);
    if (options.tag !== undefined) {
      byTitle.set(
        title,
        (
          await call('POST', `/tasks/${created.id}/tags`, {
            name: options.tag,
            color: options.tag === '仕事' ? 'indigo' : 'green',
            expectedVersion: created.version,
            expectedDay: day,
          })
        )['task'] as TaskJson,
      );
    }
  };
  /** 状態を順に変える（例：todo → doing → done なら ['doing', 'done']） */
  const go = async (title: string, ...steps: string[]) => {
    for (const to of steps) {
      const t = task(title);
      remember([
        (
          await call('POST', `/tasks/${t.id}/transition`, {
            to,
            expectedVersion: t.version,
            expectedDay: day,
          })
        )['task'],
      ]);
    }
  };
  /** 朝の計画を確定する。持ち越し候補は、指定がなければ今日に入れる */
  const morning = async (
    decisions: Record<string, CarryoverDecision> = {},
    additions: string[] = [],
  ) => {
    clock = at(day, 9);
    const carryover = await call('GET', `/days/${day}/carryover`);
    const candidates = carryover['candidates'] as TaskJson[];
    await call('POST', `/days/${day}/plan`, {
      expectedDay: day,
      decisions: candidates.map((t) => ({ taskId: t.id, decision: decisions[t.title] ?? 'today' })),
      additions: additions.map((title) => task(title).id),
    });
    await refresh();
    clock = at(day, 10);
  };
  const evening = async (thoughtsMd: string, learningMd: string, feedback = true) => {
    clock = at(day, 21);
    await call('PUT', `/days/${day}/log`, { thoughtsMd, learningMd });
    if (feedback) {
      await call('POST', '/jobs', { kind: 'daily_feedback', period: day });
      await runner.idle();
    }
  };

  const scenario: Record<number, () => Promise<void>> = {
    13: async () => {
      await morning();
      await add('TODOツール MVP', { planFor: 'today', tag: '仕事' });
      await add('D1のスキーマ設計', { parent: 'TODOツール MVP', planFor: 'today' });
      await add('Honoでルーティング', { parent: 'TODOツール MVP', planFor: 'today' });
      await add('Access のサービストークン発行', { parent: 'TODOツール MVP' });
      await add('経費精算', { planFor: 'today' });
      await add('歯医者の予約', { tag: '個人' });
      await add('確定申告の書類を集める', { tag: '個人' });
      await go('D1のスキーマ設計', 'doing');
      await go('経費精算', 'doing', 'done');
      await evening(
        'MVP の作業に入った。スキーマは思ったより論点が多い。',
        'テーブルを決める前に、画面で何を出すかを先に並べると早い。',
      );
    },
    12: async () => {
      await morning();
      await go('D1のスキーマ設計', 'done');
      await go('Honoでルーティング', 'doing');
      await add('チームの週報ドラフト', { planFor: 'today', tag: '仕事' });
      await go('チームの週報ドラフト', 'doing', 'done');
      await evening('スキーマを決めきれた。', 'ルーティングは型を先に決めると迷わない。');
    },
    11: async () => {
      await morning();
      await add('Q4プロダクト計画', { planFor: 'today', tag: '仕事' });
      await add('企画書ドラフトを書く', { parent: 'Q4プロダクト計画', planFor: 'today' });
      await go('企画書ドラフトを書く', 'doing');
      await go('Honoでルーティング', 'waiting');
      await evening(
        'ルーティングはレビュー待ち。企画書に着手した。',
        '待ちになったら、すぐ次に移ると止まらない。',
      );
    },
    10: async () => {
      await morning();
      await go('Honoでルーティング', 'doing', 'done');
      await go('企画書ドラフトを書く', 'paused');
      await add('競合調査のまとめ', { parent: 'Q4プロダクト計画', planFor: 'today' });
      await go('競合調査のまとめ', 'doing');
      await evening('企画書は材料不足で止めた。先に競合調査。', '書けないときは、材料が足りない。');
    },
    9: async () => {
      await morning({}, ['歯医者の予約']);
      await go('競合調査のまとめ', 'waiting');
      await go('企画書ドラフトを書く', 'doing');
      await go('歯医者の予約', 'doing', 'done');
      await evening('調査は資料待ち。歯医者の予約を取った。', '小さい用事は朝に片付けると楽。');
    },
    // 8、7 日前は空白日（何もしない）
    6: async () => {
      await morning();
      await add('CTOとの1on1アジェンダ', { planFor: 'today', tag: '仕事' });
      await go('CTOとの1on1アジェンダ', 'doing', 'done');
      await go('競合調査のまとめ', 'doing');
      await evening(
        '2日空いたので、持ち越しを見直してから始めた。',
        '空いた後は、計画を小さくすると戻りやすい。',
      );
    },
    5: async () => {
      await morning();
      await go('競合調査のまとめ', 'done');
      await add('採用面接の準備', { planFor: 'today', tag: '仕事' });
      await go('採用面接の準備', 'doing', 'done');
      await evening('競合調査を終えた。', '比較表にすると、企画書の骨組みが見えた。');
    },
    4: async () => {
      await morning();
      await go('企画書ドラフトを書く', 'paused');
      await add('MVP のデモ準備', { parent: 'TODOツール MVP', planFor: 'today' });
      await go('MVP のデモ準備', 'doing');
      await evening('デモの準備を優先した。', '締め切りのあるものから。');
    },
    3: async () => {
      await morning();
      await go('MVP のデモ準備', 'done');
      await go('企画書ドラフトを書く', 'doing');
      await evening(
        'デモは終わったが、とても疲れた。',
        '人前で話した日は、夕方に重い作業を入れない。',
      );
      // FB の調子より悪かったので、手で直す（FR-A03）
      await call('PUT', `/days/${day}/condition`, { userLevel: 1 });
    },
    2: async () => {
      // 着手中の企画書をバックログへ送ると、中断になる（FR-T06）
      await morning({ 企画書ドラフトを書く: 'backlog' });
      await add('経費精算（10月分）', { planFor: 'today' });
      await go('経費精算（10月分）', 'doing', 'done');
      await evening('今日は回復にあてた。', '休むと決めると、罪悪感が減る。');
    },
    1: async () => {
      await morning({}, ['Access のサービストークン発行']);
      await go('Access のサービストークン発行', 'doing');
      await evening('トークンの発行手順を調べた。', '公式の手順を先に読む。', false);
    },
    0: async () => {
      await morning({}, ['企画書ドラフトを書く']);
      await go('企画書ドラフトを書く', 'doing');
      await add('チームの週報ドラフト（今週）', { planFor: 'today', tag: '仕事' });
    },
  };

  for (let offset = SEED_DAYS - 1; offset >= 0; offset--) {
    day = shiftDay(today, -offset);
    await scenario[offset]?.();
  }
  return { from: shiftDay(today, -(SEED_DAYS - 1)), to: today };
}

export type SeedTargetError =
  | { kind: 'data_dir_missing' }
  | { kind: 'real_data_dir'; dataDir: string }
  | { kind: 'database_exists'; path: string };

/**
 * シードを入れてよいデータディレクトリかを確かめる。実データ（~/.mymind）に触れないよう、
 * MYMIND_DATA_DIR の明示を求め、~/.mymind の中は断る。既にある DB は上書きしない
 */
export function checkSeedTarget(
  env: Record<string, string | undefined>,
  home: string,
  hasFile: (path: string) => boolean,
): { ok: true; dataDir: string } | { ok: false; error: SeedTargetError } {
  const dir = env['MYMIND_DATA_DIR'];
  if (dir === undefined || dir === '') return { ok: false, error: { kind: 'data_dir_missing' } };
  const dataDir = resolve(dir);
  const fromReal = relative(resolve(home, '.mymind'), dataDir);
  if (fromReal === '' || !fromReal.startsWith('..')) {
    return { ok: false, error: { kind: 'real_data_dir', dataDir } };
  }
  const path = databasePath(dataDir);
  if (hasFile(path)) return { ok: false, error: { kind: 'database_exists', path } };
  return { ok: true, dataDir };
}
