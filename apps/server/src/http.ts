import { type BusinessDayOptions, toBusinessDay } from '@mymind/domain';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validator } from 'hono/validator';
import { z } from 'zod';

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

export const dayParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形式で指定してください');

/** 更新系の API に共通する、画面が想定している状態（NFR-13、NFR-14） */
export const screenState = {
  /** 画面が表示している業務日。現在の業務日と違えば、allowPastDay がない限り拒否する */
  expectedDay: dayParam,
  allowPastDay: z.boolean().optional(),
};
export const withVersion = { ...screenState, expectedVersion: z.number().int().positive() };

/** 古い画面からの更新を拒否する応答（NFR-13、NFR-14） */
export function createScreenGuards({
  now,
  dayOptions,
}: {
  now: () => Date;
  dayOptions: BusinessDayOptions;
}) {
  return {
    /** 画面の業務日が現在の業務日と違えば 409 を返す。問題なければ null */
    checkDay: (c: Context, body: { expectedDay: string; allowPastDay?: boolean | undefined }) => {
      const current = toBusinessDay(now(), dayOptions);
      if (body.expectedDay !== current && body.allowPastDay !== true) {
        return fail(c, 409, 'DAY_CHANGED', '業務日が変わりました。今日の画面を開き直してください', {
          currentDay: current,
        });
      }
      return null;
    },
    conflict: (
      c: Context,
      error: { kind: 'not_found' | 'version_conflict' | 'status_mismatch'; taskId: string },
    ) =>
      error.kind === 'not_found'
        ? fail(c, 404, 'NOT_FOUND', 'タスクが見つかりません', { taskId: error.taskId })
        : fail(c, 409, 'VERSION_CONFLICT', '別の画面で変更されています。読み直してください', {
            taskId: error.taskId,
          }),
  };
}

export type ScreenGuards = ReturnType<typeof createScreenGuards>;
