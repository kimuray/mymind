import type { Api } from '@mymind/server';
import { type ClientResponse, hc } from 'hono/client';
import type { SuccessStatusCode } from 'hono/utils/http-status';
import { readSessionToken, TOKEN_HEADER } from '../session';

/**
 * サーバーの API のクライアント。型は Hono RPC でサーバーと共有する（architecture.md 6章）。
 * 状態を変えるリクエストには、画面に埋め込まれたセッショントークンを付ける（ADR-0007）。
 */
export const api = hc<Api>('/api', {
  headers: (): Record<string, string> => {
    const token = readSessionToken();
    return token === null ? {} : { [TOKEN_HEADER]: token };
  },
});

/** サーバーが返したエラー（{ error: { code, message } }） */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 応答のうち、成功（2xx）のときの本文の型 */
type SuccessBody<R> =
  R extends ClientResponse<infer Body, infer Status, 'json'>
    ? Status extends SuccessStatusCode
      ? Body
      : never
    : never;

/** 失敗の応答を ApiError にする。成功なら本文を返す */
export async function unwrap<R extends ClientResponse<unknown, number, 'json'>>(
  res: R,
): Promise<SuccessBody<R>> {
  const body = (await res.json()) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error?.code ?? 'UNKNOWN',
      body.error?.message ?? '通信に失敗しました',
    );
  }
  return body as SuccessBody<R>;
}
