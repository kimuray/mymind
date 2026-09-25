import type { AgentRunner, AgentRunResult } from './runner';

/** 偽のアダプタの振る舞い。テストと E2E、開発時（MYMIND_AGENT=fake）に使う（architecture.md 7.4） */
export type FakeMode =
  /** 検証を通る JSON を返す */
  | 'success'
  /** 形式に合わない出力を返す（再試行の確認用） */
  | 'invalid'
  /** 1回目は形式違反、2回目は成功する（1回だけの再試行の確認用） */
  | 'invalid-once'
  /** 自分では終わらない（タイムアウトとキャンセルの確認用） */
  | 'hang';

export const FAKE_OUTPUT = {
  condition: { level: 3, reason: '設計に集中でき、午後の割り込みも少なかった' },
  good: ['細かい作業を午前にまとめ、午後を設計に使えた'],
  insight: ['短い作業ほど昼の割り込みで止まりやすい'],
  next_action: '週報は朝いちばんの15分で終わらせる',
};

export type FakeAgentRunner = AgentRunner & {
  /** 受け取った入力（テストで、入力の組み立てを確かめるため） */
  readonly inputs: string[];
};

/** 決まった JSON を返す偽のアダプタ。delayMs だけ待ってから答える（生成中の表示やキャンセルを確かめるため） */
export function createFakeAgentRunner(
  options: { mode?: FakeMode; delayMs?: number } = {},
): FakeAgentRunner {
  const { mode = 'success', delayMs = 0 } = options;
  const inputs: string[] = [];
  return {
    name: 'fake',
    inputs,
    run(input, { signal }) {
      inputs.push(input);
      const attempt = inputs.length;
      return new Promise<AgentRunResult>((resolve) => {
        const cancelled = () =>
          resolve({ ok: false, error: { kind: 'cancelled', message: '中断しました' } });
        if (signal.aborted) return cancelled();
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          cancelled();
        });
        const timer =
          mode === 'hang'
            ? undefined
            : setTimeout(() => {
                const valid = mode === 'success' || (mode === 'invalid-once' && attempt > 1);
                resolve({
                  ok: true,
                  output: valid
                    ? `\`\`\`json\n${JSON.stringify(FAKE_OUTPUT, null, 2)}\n\`\`\``
                    : '今日もお疲れさまでした。（JSON ではない出力）',
                });
              }, delayMs);
      });
    },
  };
}
