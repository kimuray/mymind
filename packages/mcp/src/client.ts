import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

/** サーバーの既定のポート（apps/server の config.ts と同じ） */
const DEFAULT_PORT = 4820;

const envSchema = z.object({
  MYMIND_DATA_DIR: z.string().min(1).optional(),
  MYMIND_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
});

export type Connection = { baseUrl: string; token: string | null };

/**
 * 動いているサーバーへのつなぎ方（FR-M03）。サーバーと同じ環境変数で、データディレクトリとポートを決め、
 * データディレクトリのセッショントークンを読む。トークンがなければ null（サーバーがまだ一度も起動していない）
 */
export function loadConnection(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): Connection {
  const e = envSchema.parse(env);
  const dataDir = resolve(e.MYMIND_DATA_DIR ?? join(homedir(), '.mymind'));
  let token: string | null = null;
  try {
    token = readFile(join(dataDir, 'session-token')).trim();
  } catch {
    // まだサーバーを起動したことがなければトークンはない。API を呼んだときに、動いていないことを返す
    token = null;
  }
  return { baseUrl: `http://127.0.0.1:${e.MYMIND_PORT}`, token };
}

export type ApiResult = { ok: true; body: unknown } | { ok: false; message: string };

/** サーバーの読み取りの API を呼ぶ。サーバーが動いていなければ、そのことを返す（FR-M03） */
export function createApiClient(
  connection: Connection,
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  return {
    async get(path: string, query: Record<string, string> = {}): Promise<ApiResult> {
      const url = new URL(`/api${path}`, connection.baseUrl);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: connection.token === null ? {} : { 'X-Mymind-Token': connection.token },
        });
      } catch {
        return {
          ok: false,
          message: `mymind のサーバー（${connection.baseUrl}）が動いていません。サーバーを起動してから、もう一度呼んでください`,
        };
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        return {
          ok: false,
          message: message.success
            ? message.data.error.message
            : `サーバーがエラーを返しました（${res.status}）`,
        };
      }
      return { ok: true, body };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
