import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDailyFeedbackInput, createFakeAgentRunner } from '@mymind/agent';
import { describe, expect, it } from 'vitest';
import { evaluateSample, loadSamples } from './evalPrompt';
import { loadDailyPrompt } from './prompts';

const SAMPLES = fileURLToPath(new URL('../../../prompts/eval/samples', import.meta.url));
const policy = readFileSync(
  fileURLToPath(new URL('../../../prompts/coaching-policy.md', import.meta.url)),
  'utf8',
);

describe('FR-A11 日次 FB のプロンプト', () => {
  const prompt = loadDailyPrompt();

  it('方針の本文を差し込み、ファイルを指さない（ツールを止めたエージェントはファイルを読めない）', () => {
    expect(prompt.text).toContain('必要なときは厳しく言う');
    expect(prompt.text).not.toContain('{{coaching_policy}}');
    expect(prompt.text).not.toContain('coaching-policy.md');
    // 方針の文書の見出しは、プロンプトの見出しと重ならないよう外す
    expect(prompt.text).not.toContain(policy.split('\n')[0] ?? '');
  });

  it('バージョンを読み、状態を日本語で書くよう指示している', () => {
    expect(prompt.version).toBe('0.2.0');
    for (const word of ['未着手', '着手中', '中断', '待ち', '完了', '中止']) {
      expect(prompt.text).toContain(word);
    }
  });
});

describe('FR-A11 評価用のサンプル', () => {
  const samples = loadSamples(SAMPLES);
  const prompt = loadDailyPrompt();

  it('issue の4つの日と、振り返りの中に指示がある日がそろっている', () => {
    expect(samples.map((s) => s.name)).toEqual([
      'good-day',
      'instruction-in-reflection',
      'one-line',
      'skipped-action',
      'stagnant',
    ]);
  });

  it.each(samples.map((s) => [s.name, s] as const))(
    '%s は、上限に収まり、<data> が1つの入力になる',
    (_name, sample) => {
      const input = buildDailyFeedbackInput(prompt.text, sample.data);
      expect(input.annotations).toEqual([]);
      expect(input.text.match(/<\/data>/g)).toHaveLength(1);
      expect(input.text).not.toContain('{{input_json}}');
    },
  );

  it('評価では、本番と同じ入力をエージェントに渡し、出力を本番の検証に通して記録する', async () => {
    const runner = createFakeAgentRunner();
    const sample = samples[0];
    if (sample === undefined) throw new Error('サンプルがありません');
    let t = 0;
    const result = await evaluateSample({
      sample,
      prompt,
      runner,
      model: null,
      now: () => (t += 1500),
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({
      sample: 'good-day',
      agent: 'fake',
      promptVersion: '0.2.0',
      durationMs: 1500,
      valid: true,
      error: null,
    });
    expect(runner.inputs[0]).toBe(buildDailyFeedbackInput(prompt.text, sample.data).text);
  });

  it('検証に通らない出力は、出力のまま理由を添えて記録する', async () => {
    const sample = samples[0];
    if (sample === undefined) throw new Error('サンプルがありません');
    const result = await evaluateSample({
      sample,
      prompt,
      runner: createFakeAgentRunner({ mode: 'invalid' }),
      model: 'm',
      now: () => 0,
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({ valid: false, model: 'm' });
    expect(result.error).not.toBeNull();
  });
});
