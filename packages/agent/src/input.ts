import type { Status } from '@mymind/domain';
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
  }[];
  /** domain で計算した件数（FR-A10：AI には数えさせない） */
  counts: { planned: number; done: number; doing: number; paused: number; waiting: number };
  /** 振り返り。振り返りのテーブル（daily_logs）ができるまでは null */
  reflection: { thoughtsMd: string; learningMd: string } | null;
  /** 直近の日。調子、「明日の一手」、空白日かどうかだけを渡す（全文は渡さない） */
  recent: { day: string; level: number | null; nextAction: string | null; isBlank: boolean }[];
};

/** エージェントに渡す JSON（prompts/daily-feedback.md の「入力」に合わせた名前） */
export type DailyPayload = {
  day: string;
  reflection?: { thoughts_md: string; learning_md: string };
  tasks: { title: string; status: Status; parent?: string; days: number }[];
  stats: DailyFeedbackData['counts'];
  recent: { day: string; condition: number | null; next_action: string | null; blank: boolean }[];
};

/** 段階の間を流れる入力。minimize の前は元のデータ、後はエージェントに渡す形 */
export type DailyStageInput = DailyFeedbackData | DailyPayload;

const isDailyPayload = (input: DailyStageInput): input is DailyPayload => 'stats' in input;

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
  const json = serializePayload(payload);
  return {
    text: `${prompt.trim()}\n\n<data>\n${json}\n</data>\n`,
    payload,
    annotations: result.annotations,
    charCount: json.length,
    payloadHash: hashPayload(payload),
  };
}
