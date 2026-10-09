import { MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_TASK, type Status } from '@mymind/domain';
import {
  type Annotation,
  hashPayload,
  runPipeline,
  type Stage,
  serializePayload,
} from './pipeline';

/** プロンプトの先頭のコメントからバージョンを読む（`<!-- prompt_version: 0.1.0 (draft) -->`） */
export function readPromptVersion(prompt: string): string | null {
  return prompt.match(/<!--\s*prompt_version:\s*([^\s>]+)/)?.[1] ?? null;
}

/** 日次 FB の入力の上限（architecture.md 12.5：振り返りの本文を合わせて 12,000 文字） */
export const DAILY_INPUT_MAX_CHARS = 12_000;

/** 直近の情報として渡す日数（architecture.md 12.5） */
export const RECENT_DAYS = 7;

/** 切り詰めた文字列の末尾に付け、切り詰めたことを入力の中で明示する */
export const TRUNCATION_MARKER = '…（上限を超えたため、以降を省略しました）';

/**
 * 日次 FB の元になるデータ。サーバーが DB から集め、件数と日数は domain で計算して渡す（FR-A10）。
 * ID や時刻などの余計な項目が付いていても、minimize の段階で落とす
 */
export type DailyFeedbackData = {
  day: string;
  /** その日の計画 */
  tasks: {
    title: string;
    status: Status;
    parentTitle: string | null;
    /** 今のステータスになってから何日目か（dayOrdinalSince） */
    statusDays: number;
    /** 付いているタグの名前（FR-A13）。メモ（FR-T09）は送らない */
    tags: string[];
  }[];
  /** domain で計算した件数（FR-A10：AI には数えさせない） */
  counts: { planned: number; done: number; doing: number; paused: number; waiting: number };
  /** 振り返り。保存していないか、どちらの欄も空なら null */
  reflection: { thoughtsMd: string; learningMd: string } | null;
  /** 直近の日。調子、「明日の一手」、空白日かどうかだけを渡す（全文は渡さない） */
  recent: { day: string; level: number | null; nextAction: string | null; isBlank: boolean }[];
};

/** エージェントに渡す JSON（prompts/daily-feedback.md の「入力」に合わせた名前） */
export type DailyPayload = {
  day: string;
  reflection?: { thoughts_md: string; learning_md: string };
  tasks: { title: string; status: Status; parent?: string; days: number; tags?: string[] }[];
  stats: DailyFeedbackData['counts'];
  recent: { day: string; condition: number | null; next_action: string | null; blank: boolean }[];
};

/** 段階の間を流れる入力。minimize の前は元のデータ、後はエージェントに渡す形 */
export type DailyStageInput = DailyFeedbackData | DailyPayload;

const isDailyPayload = (input: DailyStageInput): input is DailyPayload => 'stats' in input;

/**
 * タグの名前を、タグの上限（1タスクに10個、30文字）に収める（NFR-15）。
 * 保存のときにも上限で検証しているが、入力の量を決めるのはここなので、受け取った値をそのまま信じない
 */
const limitTags = (names: readonly string[]): string[] =>
  names.slice(0, MAX_TAGS_PER_TASK).map((n) => n.slice(0, MAX_TAG_NAME_LENGTH));

/** 必要な項目だけに絞る。タスクの ID、内部の時刻、設定値は送らない（architecture.md 12.5） */
export const minimizeDaily: Stage<DailyStageInput> = {
  id: 'minimize',
  apply(data) {
    if (isDailyPayload(data)) return { input: data, annotations: [] };
    const payload: DailyPayload = {
      day: data.day,
      ...(data.reflection === null
        ? {}
        : {
            reflection: {
              thoughts_md: data.reflection.thoughtsMd,
              learning_md: data.reflection.learningMd,
            },
          }),
      tasks: data.tasks.map((t) => ({
        title: t.title,
        status: t.status,
        ...(t.parentTitle === null ? {} : { parent: t.parentTitle }),
        days: t.statusDays,
        ...(t.tags.length === 0 ? {} : { tags: limitTags(t.tags) }),
      })),
      stats: {
        planned: data.counts.planned,
        done: data.counts.done,
        doing: data.counts.doing,
        paused: data.counts.paused,
        waiting: data.counts.waiting,
      },
      recent: [...data.recent]
        .sort((a, b) => (a.day < b.day ? 1 : -1))
        .slice(0, RECENT_DAYS)
        .map((r) => ({
          day: r.day,
          condition: r.level,
          next_action: r.nextAction,
          blank: r.isBlank,
        })),
    };
    return { input: payload, annotations: [] };
  },
};

const sizeOf = (payload: DailyPayload) => serializePayload(payload).length;

/** 文字列を末尾から縮め、目印を付ける。縮めても超える分は over で渡す */
function shorten(text: string, over: number): string {
  const keep = Math.max(0, text.length - over - TRUNCATION_MARKER.length);
  return text.slice(0, keep) + TRUNCATION_MARKER;
}

/**
 * 量の上限に収める（architecture.md 12.5）。
 * 超えたら古い情報（直近の日）から削り、それでも超えるなら振り返りの末尾（学び → 考えの順）を切り詰める。
 * 切り詰めた文字列には TRUNCATION_MARKER を付け、入力の中で分かるようにする
 */
export const budgetDaily: Stage<DailyStageInput> = {
  id: 'budget',
  apply(input, ctx) {
    // minimize の後に置く段階なので、元のデータのままなら何もしない
    if (!isDailyPayload(input)) return { input, annotations: [] };
    let payload = input;
    const annotations: Annotation[] = [];
    const limit = `上限の${ctx.maxChars.toLocaleString('ja-JP')}文字`;

    while (sizeOf(payload) > ctx.maxChars && payload.recent.length > 0) {
      const oldest = payload.recent[payload.recent.length - 1];
      payload = { ...payload, recent: payload.recent.slice(0, -1) };
      if (oldest !== undefined) {
        annotations.push({
          kind: 'omitted',
          path: `recent.${oldest.day}`,
          reason: `${limit}を超えたため、古い日の情報を省きました`,
        });
      }
    }

    for (const field of ['learning_md', 'thoughts_md'] as const) {
      const reflection = payload.reflection;
      const over = sizeOf(payload) - ctx.maxChars;
      if (over <= 0 || reflection === undefined || reflection[field] === '') continue;
      // JSON のエスケープ（改行など）で文字数が変わるので、収まるまで縮める
      let text = shorten(reflection[field], over);
      payload = { ...payload, reflection: { ...reflection, [field]: text } };
      while (sizeOf(payload) > ctx.maxChars && text.length > TRUNCATION_MARKER.length) {
        text = shorten(text.slice(0, -TRUNCATION_MARKER.length), sizeOf(payload) - ctx.maxChars);
        payload = { ...payload, reflection: { ...reflection, [field]: text } };
      }
      annotations.push({
        kind: 'truncated',
        path: `reflection.${field}`,
        reason: `${limit}を超えたため末尾を切り詰めました`,
      });
    }
    return { input: payload, annotations };
  },
};

/** 日次 FB の段階の並び。除外や置き換えを足すときは budget の前に入れる */
export const DAILY_STAGES: readonly Stage<DailyStageInput>[] = [minimizeDaily, budgetDaily];

export type AgentInput<P> = {
  /** エージェントに渡す全文（プロンプトと <data>） */
  text: string;
  /** 実際に送る入力（<data> の中身） */
  payload: P;
  /** 各段階の加工の注記（プレビューとログに出す） */
  annotations: Annotation[];
  /** payload の文字数 */
  charCount: number;
  /** payload のハッシュ（プレビューと依頼の突き合わせに使う。FR-A12） */
  payloadHash: string;
};

/** プロンプトの中の方針の置き場所（prompts/daily-feedback.md の「方針」） */
export const POLICY_PLACEHOLDER = '{{coaching_policy}}';

/**
 * プロンプトに方針（prompts/coaching-policy.md）の本文を差し込む（FR-A11）。
 * エージェントはツールを止めて起動するのでファイルを読めず、ファイルを指すと探しに行ってしまう（#10 の spike）。
 * 方針の正本は1つのまま、読み込むときに本文を入れる。方針の文書の見出し（# …）は、プロンプトの見出しと重ならないよう外す
 */
export function composePrompt(template: string, policy: string): string {
  const body = policy.replace(/^#\s.*\n+/, '').trim();
  return template.replace(POLICY_PLACEHOLDER, () => body);
}

/** プロンプトの中の入力の置き場所（prompts/daily-feedback.md の <data> の中） */
export const INPUT_PLACEHOLDER = '{{input_json}}';

/**
 * プロンプトの置き場所に入力の JSON を入れる。置き場所がないプロンプトなら、末尾に <data> を付ける。
 * 置き場所を残したまま末尾に足すと <data> が2つになり、エージェントが空の方を見て迷う（#10 の spike で見つけた）
 */
export function placeData(prompt: string, json: string): string {
  if (prompt.includes(INPUT_PLACEHOLDER))
    return `${prompt.trim().replace(INPUT_PLACEHOLDER, () => json)}\n`;
  return `${prompt.trim()}\n\n<data>\n${json}\n</data>\n`;
}

/** 段階を通した結果から、エージェントに渡す全文と、プレビューとログに使う値を作る */
function toAgentInput<P>(prompt: string, payload: P, annotations: Annotation[]): AgentInput<P> {
  const json = serializePayload(payload);
  return {
    text: placeData(prompt, json),
    payload,
    annotations,
    charCount: json.length,
    payloadHash: hashPayload(payload),
  };
}

/**
 * 日次 FB の入力を組み立てる（architecture.md 7.2、7.5、12.5）。
 * 利用者が書いた内容は <data> で区切ってデータとして渡し、その中の指示には従わないことをプロンプトで伝える。
 */
export function buildDailyFeedbackInput(
  prompt: string,
  data: DailyFeedbackData,
  options: {
    stages?: readonly Stage<DailyStageInput>[];
    maxChars?: number;
  } = {},
): AgentInput<DailyPayload> {
  const result = runPipeline(options.stages ?? DAILY_STAGES, data, {
    maxChars: options.maxChars ?? DAILY_INPUT_MAX_CHARS,
  });
  const payload = result.input;
  if (!isDailyPayload(payload)) throw new Error('日次 FB の段階に minimize がありません');
  return toAgentInput(prompt, payload, result.annotations);
}

/** 月次総括の入力の上限（architecture.md 12.5。日次 FB の要点を1か月分渡すので、日次より広くとる） */
export const MONTHLY_INPUT_MAX_CHARS = 20_000;

/** 日次 FB がない日に渡す、振り返りの冒頭の文字数（architecture.md 12.5） */
export const REFLECTION_HEAD_CHARS = 200;

/**
 * 月次総括の元になるデータ（FR-A06）。サーバーが DB から集め、件数と日数はコードで計算して渡す（FR-A10）。
 * 日は、月の初日から through（月の途中なら今日、過ぎた月なら月末）まで
 */
export type MonthlySummaryData = {
  month: string;
  /** 月の途中で依頼したか（途中経過として扱う） */
  isPartial: boolean;
  through: string;
  stats: {
    /** 計画か振り返りのある日 */
    recordedDays: number;
    /** 空白日（architecture.md 4.5） */
    blankDays: number;
    /** 日次 FB をもらった日 */
    feedbackDays: number;
    /** 調子を手で直した日（AI の判定と違う値を付けた日） */
    correctedDays: number;
    /** 完了したタスクの数（振り返りの「完了」と同じ定義の合計） */
    completed: number;
    /**
     * タグごとの集計（FR-R08、FR-A13）。domain の tagStats で数えた値。tag が null の行は「タグなし」。
     * 完了の数と、着手中・待ちの日数（タスクごとに足したもの）
     */
    byTag: { tag: string | null; completed: number; doingDays: number; waitingDays: number }[];
  };
  days: {
    day: string;
    isBlank: boolean;
    /** AI の判定と手で直した値。どちらもなければ null */
    condition: { ai: number | null; user: number | null } | null;
    /** その日の最新の日次 FB の要点 */
    feedback: { good: string[]; insight: string[]; nextAction: string } | null;
    /** 振り返り。日次 FB がない日だけ、冒頭を送る */
    reflection: { thoughtsMd: string; learningMd: string } | null;
  }[];
};

/** エージェントに渡す JSON（prompts/monthly-summary.md の「入力」に合わせた名前） */
export type MonthlyPayload = {
  month: string;
  partial: boolean;
  through: string;
  stats: {
    recorded_days: number;
    blank_days: number;
    feedback_days: number;
    corrected_days: number;
    completed: number;
    by_tag: { tag: string | null; completed: number; doing_days: number; waiting_days: number }[];
  };
  days: {
    day: string;
    blank: boolean;
    condition_ai: number | null;
    condition_user: number | null;
    good?: string[];
    insight?: string[];
    next_action?: string;
    reflection_head?: string;
  }[];
};

export type MonthlyStageInput = MonthlySummaryData | MonthlyPayload;

const isMonthlyPayload = (input: MonthlyStageInput): input is MonthlyPayload => 'partial' in input;

/** 振り返りの冒頭。考えと学びをつなげて、REFLECTION_HEAD_CHARS で切る */
function reflectionHead(reflection: { thoughtsMd: string; learningMd: string }): string | null {
  const text = [reflection.thoughtsMd.trim(), reflection.learningMd.trim()]
    .filter((t) => t !== '')
    .join('\n');
  if (text === '') return null;
  return text.length <= REFLECTION_HEAD_CHARS
    ? text
    : text.slice(0, REFLECTION_HEAD_CHARS) + TRUNCATION_MARKER;
}

/**
 * 必要な項目だけに絞る（architecture.md 12.5）。振り返りの全文は送らず、日次 FB の要点を送る。
 * 日次 FB がない日は、振り返りの冒頭だけを送る
 */
export const minimizeMonthly: Stage<MonthlyStageInput> = {
  id: 'minimize',
  apply(data) {
    if (isMonthlyPayload(data)) return { input: data, annotations: [] };
    const payload: MonthlyPayload = {
      month: data.month,
      partial: data.isPartial,
      through: data.through,
      stats: {
        recorded_days: data.stats.recordedDays,
        blank_days: data.stats.blankDays,
        feedback_days: data.stats.feedbackDays,
        corrected_days: data.stats.correctedDays,
        completed: data.stats.completed,
        by_tag: data.stats.byTag.map((t) => ({
          tag: t.tag === null ? null : t.tag.slice(0, MAX_TAG_NAME_LENGTH),
          completed: t.completed,
          doing_days: t.doingDays,
          waiting_days: t.waitingDays,
        })),
      },
      days: [...data.days]
        .sort((a, b) => (a.day < b.day ? -1 : 1))
        .map((d) => {
          const head =
            d.feedback === null && d.reflection !== null ? reflectionHead(d.reflection) : null;
          return {
            day: d.day,
            blank: d.isBlank,
            condition_ai: d.condition?.ai ?? null,
            condition_user: d.condition?.user ?? null,
            ...(d.feedback === null
              ? {}
              : {
                  good: d.feedback.good,
                  insight: d.feedback.insight,
                  next_action: d.feedback.nextAction,
                }),
            ...(head === null ? {} : { reflection_head: head }),
          };
        }),
    };
    return { input: payload, annotations: [] };
  },
};

const monthlySize = (payload: MonthlyPayload) => serializePayload(payload).length;

type MonthlyDay = MonthlyPayload['days'][number];

/** 上限に収めるために古い日から順に省くもの。前の手順で収まらなければ次へ進む */
const MONTHLY_TRIMS: readonly {
  applies: (day: MonthlyDay) => boolean;
  trim: (day: MonthlyDay) => MonthlyDay;
  what: string;
}[] = [
  {
    applies: (day) => day.reflection_head !== undefined,
    trim: ({ reflection_head: _, ...rest }) => rest,
    what: '振り返りの冒頭',
  },
  {
    applies: (day) => day.good !== undefined || day.insight !== undefined,
    trim: ({ good: _good, insight: _insight, ...rest }) => rest,
    what: 'よかったことと気づき',
  },
];

/**
 * 量の上限に収める（architecture.md 12.5）。古い日から順に、振り返りの冒頭を省き、
 * それでも超えるなら日次 FB の「よかったこと」と「気づき」を省く（調子と明日の一手は残す）。
 * 週ごとの要約を先に作る段階は、まだない（上限を超える月が出てきたら加える）
 */
export const budgetMonthly: Stage<MonthlyStageInput> = {
  id: 'budget',
  apply(input, ctx) {
    if (!isMonthlyPayload(input)) return { input, annotations: [] };
    let payload = input;
    const annotations: Annotation[] = [];
    const limit = `上限の${ctx.maxChars.toLocaleString('ja-JP')}文字`;
    for (const { applies, trim, what } of MONTHLY_TRIMS) {
      for (let i = 0; i < payload.days.length && monthlySize(payload) > ctx.maxChars; i++) {
        const day = payload.days[i];
        if (day === undefined || !applies(day)) continue;
        const trimmed = trim(day);
        payload = { ...payload, days: payload.days.map((d, j) => (j === i ? trimmed : d)) };
        annotations.push({
          kind: 'omitted',
          path: `days.${day.day}`,
          reason: `${limit}を超えたため、古い日の${what}を省きました`,
        });
      }
    }
    return { input: payload, annotations };
  },
};

/** 月次総括の段階の並び。除外や置き換えを足すときは budget の前に入れる */
export const MONTHLY_STAGES: readonly Stage<MonthlyStageInput>[] = [minimizeMonthly, budgetMonthly];

/** 月次総括の入力を組み立てる（FR-A06、architecture.md 7.2、12.5） */
export function buildMonthlySummaryInput(
  prompt: string,
  data: MonthlySummaryData,
  options: { stages?: readonly Stage<MonthlyStageInput>[]; maxChars?: number } = {},
): AgentInput<MonthlyPayload> {
  const result = runPipeline(options.stages ?? MONTHLY_STAGES, data, {
    maxChars: options.maxChars ?? MONTHLY_INPUT_MAX_CHARS,
  });
  const payload = result.input;
  if (!isMonthlyPayload(payload)) throw new Error('月次総括の段階に minimize がありません');
  return toAgentInput(prompt, payload, result.annotations);
}
