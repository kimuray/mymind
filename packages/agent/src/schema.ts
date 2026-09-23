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

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * エージェントの出力文字列からJSONを取り出して検証する。
 * ```json ... ``` のコードブロックで囲まれた出力にも対応する。
 */
export function parseDailyFeedback(raw: string): ParseResult<DailyFeedback> {
  const json = extractJson(raw);
  if (json === null) return { ok: false, error: 'JSON が見つかりません' };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON として解釈できません' };
  }
  const result = dailyFeedbackSchema.safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  return { ok: true, value: result.data };
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end < start) return null;
  return body.slice(start, end + 1);
}
