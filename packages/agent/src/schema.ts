import type { JobKind } from '@mymind/domain';
import { z } from 'zod';

/** 調子：0=絶不調 〜 4=絶好調（FR-A02） */
export const conditionLevelSchema = z.number().int().min(0).max(4);

export const dailyFeedbackSchema = z
  .object({
    condition: z
      .object({
        level: conditionLevelSchema,
        reason: z.string().min(1).max(200),
      })
      .strict(),
    good: z.array(z.string().min(1)).min(1).max(5),
    insight: z.array(z.string().min(1)).max(5),
    next_action: z.string().min(1).max(200),
  })
  .strict();

export type DailyFeedback = z.infer<typeof dailyFeedbackSchema>;

/**
 * 月次総括（FR-A06、architecture.md 7.3）。各項目の文章は Markdown を許し、表示するときにサニタイズする。
 * self_gap は、AI の判定と手動で直した調子のズレについての考察。ズレがなければ、そのことを書く
 */
export const monthlySummarySchema = z
  .object({
    learnings: z.array(z.string().min(1).max(400)).min(1).max(5),
    trends: z.array(z.string().min(1).max(400)).max(5),
    self_gap: z.string().min(1).max(600),
    proposals: z.array(z.string().min(1).max(300)).min(1).max(3),
  })
  .strict();

export type MonthlySummary = z.infer<typeof monthlySummarySchema>;

/**
 * エージェントの構造化出力に渡す JSON Schema（claude --json-schema、codex --output-schema。ADR-0005）。
 * Claude Code は "$schema"（2020-12 の指定）を解釈できずに止まるので、draft-07 で作って "$schema" を外す
 */
const toAgentJsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { target: 'draft-7' });
  return json;
};

export const dailyFeedbackJsonSchema = toAgentJsonSchema(dailyFeedbackSchema);
export const monthlySummaryJsonSchema = toAgentJsonSchema(monthlySummarySchema);

/** ジョブの種類ごとに、エージェントに求める出力の形 */
export const OUTPUT_JSON_SCHEMAS: Readonly<Record<JobKind, Record<string, unknown>>> = {
  daily_feedback: dailyFeedbackJsonSchema,
  monthly_summary: monthlySummaryJsonSchema,
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * エージェントの出力文字列から JSON を取り出し、スキーマで検証する。
 * ```json ... ``` のコードブロックで囲まれた出力にも対応する。
 */
function parseAgentJson<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  const json = extractJson(raw);
  if (json === null) return { ok: false, error: 'JSON が見つかりません' };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON として解釈できません' };
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, value: result.data };
}

export const parseDailyFeedback = (raw: string): ParseResult<DailyFeedback> =>
  parseAgentJson(raw, dailyFeedbackSchema);

export const parseMonthlySummary = (raw: string): ParseResult<MonthlySummary> =>
  parseAgentJson(raw, monthlySummarySchema);

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  return body.slice(start, end + 1);
}
