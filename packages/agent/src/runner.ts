/**
 * エージェントを起動する境界（ADR-0003、architecture.md 7.4）。
 * サーバーはこのインターフェースだけを使い、child_process を直接使わない。
 */
export type AgentRunner = {
  /** 設定や FB の記録に残す名前（claude / codex / fake） */
  readonly name: string;
  /** 決まった入力を渡し、出力の文字列を受け取る。signal が中断されたら、すぐにやめて cancelled を返す */
  run(input: string, options: { signal: AbortSignal }): Promise<AgentRunResult>;
};

export type AgentRunResult =
  | { ok: true; output: string }
  | { ok: false; error: { kind: 'cancelled' | 'failed'; message: string } };

/** 一定時間で signal を中断させる。キャンセル（外からの中断）とタイムアウトを区別できるようにする */
export function withTimeout(
  signal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) controller.abort();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
  };
}

/** まだ作っていないアダプタ。選ばれたら、理由を付けて失敗する（claude / codex は #10 の後で作る） */
export function unavailableRunner(name: string, reason: string): AgentRunner {
  return {
    name,
    run: async () => ({ ok: false, error: { kind: 'failed', message: reason } }),
  };
}
