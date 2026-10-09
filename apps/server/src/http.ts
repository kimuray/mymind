import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import type { z } from 'zod';

/** API のエラーの種類（architecture.md 6章） */
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'DAY_CHANGED'
  | 'INVALID_TRANSITION'
  | 'DEPTH_EXCEEDED'
  | 'PLAN_CONFIRMED'
  | 'NOT_IN_BACKLOG'
  | 'NOT_REVIEW_TARGET'
  | 'DUPLICATE_TAG'
  | 'TOO_MANY_TAGS';

/** エラーの応答。状態コードを型に残し、Hono RPC のクライアントが成功と失敗を区別できるようにする */
export function fail<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  code: ErrorCode,
  message: string,
  extra = {},
) {
  return c.json({ error: { code, message, ...extra } }, status);
}

/**
 * JSON の本文を zod で検証するミドルウェア。形が違えば 400 を返す。
 * 入力の型は Hono RPC で画面と共有される（architecture.md 6章）。
 */
export const jsonBody = <T extends z.ZodType>(schema: T) =>
  validator('json', (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return fail(c, 400, 'INVALID_REQUEST', '入力が正しくありません', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return parsed.data as z.infer<T>;
  });
