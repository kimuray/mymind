import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildDailyFeedbackInput,
  buildMonthlySummaryInput,
  createFakeAgentRunner,
  FAKE_MONTHLY_OUTPUT,
} from '@mymind/agent';
import { describe, expect, it } from 'vitest';
import {
  evaluateMonthlySample,
  evaluateSample,
  loadMonthlySamples,
  loadSamples,
} from './evalPrompt';
import { loadDailyPrompt, loadMonthlyPrompt } from './prompts';

const SAMPLES = fileURLToPath(new URL('../../../prompts/eval/samples', import.meta.url));
const MONTHLY_SAMPLES = fileURLToPath(
  new URL('../../../prompts/eval/monthly-samples', import.meta.url),
);
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
    expect(prompt.version).toBe('1.1.0');
    for (const word of ['未着手', '着手中', '中断', '待ち', '完了', '中止']) {
      expect(prompt.text).toContain(word);
    }
  });
});

describe('FR-A06 FR-A11 月次総括のプロンプト', () => {
  const prompt = loadMonthlyPrompt();

  it('方針の本文を差し込み、入力の置き場所を1つだけ持つ', () => {
    expect(prompt.text).toContain('必要なときは厳しく言う');
    expect(prompt.text).not.toContain('{{coaching_policy}}');
    expect(prompt.text.match(/\{\{input_json\}\}/g)).toHaveLength(1);
  });

  it('下書きのバージョンを読み、途中経過と数値の扱いを指示している', () => {
    expect(prompt.version).toBe('0.2.0');
    expect(prompt.text).toContain('途中経過');
    expect(prompt.text).toContain('`stats` の値だけを使い');
    for (const key of ['learnings', 'trends', 'self_gap', 'proposals']) {
      expect(prompt.text).toContain(key);
    }
  });
});

describe('FR-A11 評価から書き足した指示（0.3.0、0.4.0）', () => {
  const { text } = loadDailyPrompt();

  it.each([
    ['調子の目安（一言の前向きさでは 4 にしない）', '一言の前向きさだけでは 4 にしない'],
    ['問いは FB 全体で1つまで', '問いの形にするのは、FB 全体で1つまで'],
    ['調子が低い日は厳しい指摘を1つまで', '厳しい指摘は `insight` 全体で1つまで'],
    ['明日の一手は行動1つ', '行動を1つだけ、1文で書く'],
    [
      '厳しく言う場面に当たる日は、調子が低くても指摘する',
      '厳しく言う場面に当たる日は、調子が低くても',
    ],
    [
      '実行できなかった一手をそのまま繰り返さない',
      '同じ一手をそのまま繰り返さず、やり方か大きさを変える',
    ],
  ])('%s', (_name, phrase) => {
    expect(text).toContain(phrase);
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
      promptVersion: '1.1.0',
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

describe('FR-A06 月次総括の評価用のサンプル', () => {
  const samples = loadMonthlySamples(MONTHLY_SAMPLES);
  const prompt = loadMonthlyPrompt();

  it('issue の5つの月（好調、停滞、記録が少ない、月の途中、データの中に指示）がそろっている', () => {
    expect(samples.map((s) => s.name)).toEqual([
      'good-month',
      'instruction-in-data',
      'partial-month',
      'sparse-month',
      'stagnant-month',
    ]);
    expect(samples.find((s) => s.name === 'partial-month')?.data.isPartial).toBe(true);
  });

  it.each(samples.map((s) => [s.name, s] as const))(
    '%s は、集計値が日ごとの記録と合い、上限に収まる入力になる',
    (_name, sample) => {
      const { days, stats } = sample.data;
      expect(stats.recordedDays + stats.blankDays).toBe(days.length);
      expect(stats.feedbackDays).toBe(days.filter((d) => d.feedback !== null).length);
      const input = buildMonthlySummaryInput(prompt.text, sample.data);
      expect(input.annotations).toEqual([]);
      expect(input.text.match(/<\/data>/g)).toHaveLength(1);
    },
  );

  it('評価では、月次の入力をエージェントに渡し、出力を月次総括の検証に通す', async () => {
    const runner = createFakeAgentRunner();
    const sample = samples[0];
    if (sample === undefined) throw new Error('サンプルがありません');
    const result = await evaluateMonthlySample({
      sample,
      prompt,
      runner,
      model: null,
      now: () => 0,
      timeoutMs: 1000,
    });
    expect(result).toMatchObject({
      sample: sample.name,
      valid: true,
      feedback: FAKE_MONTHLY_OUTPUT,
      promptVersion: prompt.version,
    });
    expect(runner.inputs[0]).toBe(buildMonthlySummaryInput(prompt.text, sample.data).text);
  });
});

describe('FR-A13 プロンプトのタグの説明', () => {
  it('日次 FB のプロンプトは、タスクの tags の意味を説明している', () => {
    expect(loadDailyPrompt().text).toContain('`tags` は利用者がタスクを分類するために付けた名前');
  });

  it('月次総括のプロンプトは、stats.by_tag の意味と、足しても完了の数にならないことを説明している', () => {
    const { text } = loadMonthlyPrompt();
    expect(text).toContain('`by_tag`');
    expect(text).toContain('行を足しても `completed` にはなりません');
  });
});
