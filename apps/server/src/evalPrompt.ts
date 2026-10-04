import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  type AgentRunner,
  buildDailyFeedbackInput,
  type DailyFeedbackData,
  parseDailyFeedback,
} from '@mymind/agent';
import { STATUSES } from '@mymind/domain';
import { z } from 'zod';

/** 評価用のサンプル（prompts/eval/samples/*.json）。どんな日かの説明と、エージェントに渡す元のデータ */
const sampleSchema = z.strictObject({
  title: z.string().min(1),
  data: z.strictObject({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tasks: z.array(
      z.strictObject({
        title: z.string().min(1),
        status: z.enum(STATUSES),
        parentTitle: z.string().nullable(),
        statusDays: z.number().int().min(1),
      }),
    ),
    counts: z.strictObject({
      planned: z.number().int().min(0),
      done: z.number().int().min(0),
      doing: z.number().int().min(0),
      paused: z.number().int().min(0),
      waiting: z.number().int().min(0),
    }),
    reflection: z.strictObject({ thoughtsMd: z.string(), learningMd: z.string() }).nullable(),
    recent: z.array(
      z.strictObject({
        day: z.string(),
        level: z.number().int().min(0).max(4).nullable(),
        nextAction: z.string().nullable(),
        isBlank: z.boolean(),
      }),
    ),
  }),
});

export type EvalSample = { name: string; title: string; data: DailyFeedbackData };

/** サンプルを読み、形を確かめる。形が違えば、どのファイルかを添えて止める */
export function loadSamples(dir: string): EvalSample[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const parsed = sampleSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      if (!parsed.success) {
        throw new Error(`${file} の形が違います：${parsed.error.issues[0]?.message ?? ''}`);
      }
      return { name: basename(file, '.json'), ...parsed.data };
    });
}

/** 1つのサンプルの評価の結果。PR に添付し、プロンプトの新旧を比べる材料にする */
export type EvalResult = {
  sample: string;
  title: string;
  agent: string;
  model: string | null;
  promptVersion: string;
  durationMs: number;
  /** 本番の検証（parseDailyFeedback）に通ったか */
  valid: boolean;
  feedback: unknown;
  error: string | null;
};

/** 1つのサンプルで FB を作り、本番の検証に通す。入力は本番と同じ関数で組み立てる */
export async function evaluateSample(input: {
  sample: EvalSample;
  prompt: { text: string; version: string };
  runner: AgentRunner;
  model: string | null;
  now: () => number;
  timeoutMs: number;
}): Promise<EvalResult> {
  const { sample, prompt, runner, model, now } = input;
  const agentInput = buildDailyFeedbackInput(prompt.text, sample.data);
  const started = now();
  const result = await runner.run(agentInput.text, {
    signal: AbortSignal.timeout(input.timeoutMs),
    kind: 'daily_feedback',
  });
  const base = {
    sample: sample.name,
    title: sample.title,
    agent: runner.name,
    model,
    promptVersion: prompt.version,
    durationMs: now() - started,
  };
  if (!result.ok) return { ...base, valid: false, feedback: null, error: result.error.message };
  const parsed = parseDailyFeedback(result.output);
  return parsed.ok
    ? { ...base, valid: true, feedback: parsed.value, error: null }
    : { ...base, valid: false, feedback: result.output, error: parsed.error };
}
