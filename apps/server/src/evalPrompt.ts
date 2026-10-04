import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  type AgentRunner,
  buildDailyFeedbackInput,
  buildMonthlySummaryInput,
  type DailyFeedbackData,
  type MonthlySummaryData,
  type ParseResult,
  parseDailyFeedback,
  parseMonthlySummary,
} from '@mymind/agent';
import type { JobKind } from '@mymind/domain';
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
  /** 本番の検証（parseDailyFeedback か parseMonthlySummary）に通ったか */
  valid: boolean;
  feedback: unknown;
  error: string | null;
};

type EvalContext = {
  prompt: { text: string; version: string };
  runner: AgentRunner;
  model: string | null;
  now: () => number;
  timeoutMs: number;
};

/** 組み立てた入力でエージェントを1回呼び、本番の検証に通す（日次 FB と月次総括で共通） */
async function runEval(
  ctx: EvalContext,
  sample: { name: string; title: string },
  kind: JobKind,
  text: string,
  parse: (raw: string) => ParseResult<unknown>,
): Promise<EvalResult> {
  const started = ctx.now();
  const result = await ctx.runner.run(text, { signal: AbortSignal.timeout(ctx.timeoutMs), kind });
  const base = {
    sample: sample.name,
    title: sample.title,
    agent: ctx.runner.name,
    model: ctx.model,
    promptVersion: ctx.prompt.version,
    durationMs: ctx.now() - started,
  };
  if (!result.ok) return { ...base, valid: false, feedback: null, error: result.error.message };
  const parsed = parse(result.output);
  return parsed.ok
    ? { ...base, valid: true, feedback: parsed.value, error: null }
    : { ...base, valid: false, feedback: result.output, error: parsed.error };
}

/** 1つのサンプルで FB を作り、本番の検証に通す。入力は本番と同じ関数で組み立てる */
export function evaluateSample(input: EvalContext & { sample: EvalSample }): Promise<EvalResult> {
  const { sample, prompt } = input;
  const text = buildDailyFeedbackInput(prompt.text, sample.data).text;
  return runEval(input, sample, 'daily_feedback', text, parseDailyFeedback);
}

/** 月次総括の評価用のサンプル（prompts/eval/monthly-samples/*.json、#140） */
const conditionLevel = z.number().int().min(0).max(4).nullable();
const monthlySampleSchema = z.strictObject({
  title: z.string().min(1),
  data: z.strictObject({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    isPartial: z.boolean(),
    through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    stats: z.strictObject({
      recordedDays: z.number().int().min(0),
      blankDays: z.number().int().min(0),
      feedbackDays: z.number().int().min(0),
      correctedDays: z.number().int().min(0),
      completed: z.number().int().min(0),
    }),
    days: z.array(
      z.strictObject({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        isBlank: z.boolean(),
        condition: z.strictObject({ ai: conditionLevel, user: conditionLevel }).nullable(),
        feedback: z
          .strictObject({
            good: z.array(z.string()),
            insight: z.array(z.string()),
            nextAction: z.string(),
          })
          .nullable(),
        reflection: z.strictObject({ thoughtsMd: z.string(), learningMd: z.string() }).nullable(),
      }),
    ),
  }),
});

export type MonthlyEvalSample = { name: string; title: string; data: MonthlySummaryData };

/** 月次総括のサンプルを読み、形を確かめる */
export function loadMonthlySamples(dir: string): MonthlyEvalSample[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const parsed = monthlySampleSchema.safeParse(
        JSON.parse(readFileSync(join(dir, file), 'utf8')),
      );
      if (!parsed.success) {
        throw new Error(`${file} の形が違います：${parsed.error.issues[0]?.message ?? ''}`);
      }
      return { name: basename(file, '.json'), ...parsed.data };
    });
}

/** 1つのサンプルで月次総括を作り、本番の検証に通す（FR-A06、#140） */
export function evaluateMonthlySample(
  input: EvalContext & { sample: MonthlyEvalSample },
): Promise<EvalResult> {
  const { sample, prompt } = input;
  const text = buildMonthlySummaryInput(prompt.text, sample.data).text;
  return runEval(input, sample, 'monthly_summary', text, parseMonthlySummary);
}
