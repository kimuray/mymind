import type { Status } from '@mymind/domain';

/** プロンプトの先頭のコメントからバージョンを読む（`<!-- prompt_version: 0.1.0 (draft) -->`） */
export function readPromptVersion(prompt: string): string | null {
  return prompt.match(/<!--\s*prompt_version:\s*([^\s>]+)/)?.[1] ?? null;
}

export type DailyFeedbackData = {
  day: string;
  /** その日の計画（タイトルとステータス） */
  tasks: { title: string; status: Status; parentTitle: string | null }[];
  /** domain で計算した件数（FR-A10：AI には数えさせない） */
  counts: { planned: number; done: number; doing: number; paused: number; waiting: number };
};

/**
 * 日次 FB の入力を組み立てる（architecture.md 7.2、7.5）。
 * 利用者が書いた内容は <data> で区切ってデータとして渡し、その中の指示には従わないことをプロンプトで伝える。
 * 振り返りの本文、イベント、直近7日の調子は、それぞれのテーブルと入力の最小化（#43）ができてから加える。
 */
export function buildDailyFeedbackInput(prompt: string, data: DailyFeedbackData): string {
  const payload = {
    day: data.day,
    counts: data.counts,
    tasks: data.tasks.map((t) => ({
      title: t.title,
      status: t.status,
      ...(t.parentTitle === null ? {} : { parent: t.parentTitle }),
    })),
  };
  return `${prompt.trim()}\n\n<data>\n${JSON.stringify(payload, null, 2)}\n</data>\n`;
}
