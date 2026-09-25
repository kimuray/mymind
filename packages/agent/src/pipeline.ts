/**
 * 送信前処理のパイプライン（NFR-15、architecture.md 12.5）。
 * 入力は決まった順序の段階（stage）を通して作る。各段階は純粋関数で、加工した入力と、何をしたかの注記を返す。
 * 除外や置き換えは、将来 budget の前に段階を足して実現する。注記の種類を足せば、プレビュー（FR-A12）は変えずに表示できる。
 */

export type AnnotationKind = 'truncated' | 'omitted';

export type Annotation = {
  kind: AnnotationKind;
  /** 加工した箇所（例：'reflection.thoughts_md'、'recent.2026-09-20'） */
  path: string;
  /** 画面に表示する理由 */
  reason: string;
};

export type StageContext = {
  /** 入力（<data> の中の JSON）の文字数の上限 */
  maxChars: number;
};

export type StageResult<T> = { input: T; annotations: Annotation[] };

export type Stage<T> = {
  id: string;
  apply(input: T, ctx: StageContext): StageResult<T>;
};

/** 段階を順に通し、注記を集める */
export function runPipeline<T>(
  stages: readonly Stage<T>[],
  input: T,
  ctx: StageContext,
): StageResult<T> {
  let current = input;
  const annotations: Annotation[] = [];
  for (const stage of stages) {
    const result = stage.apply(current, ctx);
    current = result.input;
    annotations.push(...result.annotations);
  }
  return { input: current, annotations };
}

/** エージェントに渡す JSON の文字数（上限の判定とプレビューの表示に同じ数え方を使う） */
export const serializePayload = (payload: unknown) => JSON.stringify(payload, null, 2);
