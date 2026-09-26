import { describe, expect, it } from 'vitest';
import { createFakeAgentRunner, FAKE_OUTPUT } from './fake';
import { withTimeout } from './runner';
import { parseDailyFeedback } from './schema';

const run = (
  runner: ReturnType<typeof createFakeAgentRunner>,
  signal = new AbortController().signal,
) => runner.run('入力', { signal });

describe('ADR-0003 偽のアダプタ', () => {
  it('成功のモードでは、検証を通る JSON をコードブロックで返す', async () => {
    const result = await run(createFakeAgentRunner());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseDailyFeedback(result.output)).toEqual({ ok: true, value: FAKE_OUTPUT });
  });

  it('形式違反のモードでは、検証を通らない出力を返す', async () => {
    const result = await run(createFakeAgentRunner({ mode: 'invalid' }));
    expect(result.ok && parseDailyFeedback(result.output).ok).toBe(false);
  });

  it('1回だけ形式違反のモードでは、2回目に成功する', async () => {
    const runner = createFakeAgentRunner({ mode: 'invalid-once' });
    const first = await run(runner);
    const second = await run(runner);
    expect(first.ok && parseDailyFeedback(first.output).ok).toBe(false);
    expect(second.ok && parseDailyFeedback(second.output).ok).toBe(true);
  });

  it('中断されたら、すぐにやめてキャンセルを返す', async () => {
    const controller = new AbortController();
    const pending = run(createFakeAgentRunner({ mode: 'hang' }), controller.signal);
    controller.abort();
    expect(await pending).toEqual({
      ok: false,
      error: { kind: 'cancelled', message: '中断しました' },
    });
  });

  it('受け取った入力を記録する', async () => {
    const runner = createFakeAgentRunner();
    await run(runner);
    expect(runner.inputs).toEqual(['入力']);
  });
});

describe('FR-A08 タイムアウト', () => {
  it('時間が過ぎたら中断し、タイムアウトだったと分かる', async () => {
    const t = withTimeout(new AbortController().signal, 10);
    const result = await createFakeAgentRunner({ mode: 'hang' }).run('入力', { signal: t.signal });
    t.dispose();
    expect(result.ok).toBe(false);
    expect(t.timedOut()).toBe(true);
  });

  it('外からの中断はタイムアウトとして扱わない', async () => {
    const controller = new AbortController();
    const t = withTimeout(controller.signal, 10_000);
    controller.abort();
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(false);
    t.dispose();
  });
});
