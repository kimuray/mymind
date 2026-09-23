import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const TOKEN_HEADER = 'X-Mymind-Token';

/** 状態を変えないメソッド。これ以外は Origin とトークンの確認を必須にする */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type SecurityOptions = {
  /** ブラウザが開くポート。本番はサーバーのポート、開発時は Vite のポートも加える */
  ports: number[];
  sessionToken: string;
};

type RejectReason = 'host' | 'fetch_site' | 'origin' | 'token';

const MESSAGES: Record<RejectReason, string> = {
  host: 'Host ヘッダーが許可されていません',
  fetch_site: '同じオリジンからのリクエストではありません',
  origin: 'Origin ヘッダーが許可されていません',
  token: 'セッショントークンが一致しません',
};

/** 127.0.0.1 と localhost の両方で開けるようにする（ブラウザのアドレス欄の書き方の違い） */
export function allowedHosts(ports: number[]): Set<string> {
  return new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
}

function isSameToken(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // 長さが違うと timingSafeEqual は例外を投げるので、先に比べる
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * ローカルサーバーを、ブラウザで開いた別のサイトから操作されないように守る（NFR-02、ADR-0007）。
 * すべてのリクエストで Host を確かめ（DNS リバインディング対策）、
 * 状態を変えるリクエストでは Fetch Metadata、Origin、独自ヘッダーのトークンをすべて確かめる。
 */
export function localOnly(options: SecurityOptions): MiddlewareHandler {
  const hosts = allowedHosts(options.ports);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  return async (c, next) => {
    const reject = (reason: RejectReason) =>
      c.json({ error: { code: `forbidden_${reason}`, message: MESSAGES[reason] } }, 403);

    const host = c.req.header('Host');
    if (host === undefined || !hosts.has(host)) return reject('host');

    if (!SAFE_METHODS.has(c.req.method)) {
      if (c.req.header('Sec-Fetch-Site') !== 'same-origin') return reject('fetch_site');
      const origin = c.req.header('Origin');
      if (origin === undefined || !origins.has(origin)) return reject('origin');
      if (!isSameToken(c.req.header(TOKEN_HEADER), options.sessionToken)) return reject('token');
    }

    return next();
  };
}
