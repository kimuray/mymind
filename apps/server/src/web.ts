import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

/** 画面に渡すセッショントークンの meta タグの名前（ADR-0007）。apps/web の Vite プラグインと揃える */
export const TOKEN_META = 'mymind-token';
/** CodeMirror の EditorView.cspNonce に渡すノンスの meta タグの名前 */
export const NONCE_META = 'mymind-csp-nonce';

/**
 * 本番の CSP（ADR-0007）。スクリプトは同梱のファイルだけ、スタイルは同梱のファイルとノンス付きのものだけを許す。
 * 開発サーバー（Vite）は HMR のために CSP を付けないので、E2E は必ずこの本番の構成で実行する。
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** index.html の <head> に、トークンとノンスの meta タグを差し込む */
export function injectMeta(html: string, meta: Record<string, string>): string {
  const tags = Object.entries(meta)
    .map(([name, content]) => `<meta name="${name}" content="${escapeAttr(content)}">`)
    .join('');
  return html.replace('</head>', `${tags}</head>`);
}

export type WebOptions = {
  /** apps/web の本番ビルド（vite build の出力） */
  distDir: string;
  sessionToken: string;
  newNonce?: () => string;
};

/**
 * 画面の本番ビルドを配信する。/assets/ は同梱のファイル、それ以外の GET は index.html を返し、
 * 画面側のルーター（TanStack Router）が URL を解釈する。トークンを返す API は作らない（ADR-0007）。
 * ビルドがない（開発時に Vite で画面を開く）場合は null を返し、API だけを配信する。
 */
export function createWebRoutes({
  distDir,
  sessionToken,
  newNonce = () => randomBytes(16).toString('base64'),
}: WebOptions): Hono | null {
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) return null;
  const indexHtml = readFileSync(indexPath, 'utf8');

  return new Hono().use('/assets/*', serveStatic({ root: distDir })).get('*', (c) => {
    // API の未定義のパスに画面を返すと、クライアントが HTML を JSON として読んでしまう
    if (c.req.path.startsWith('/api/')) return c.notFound();
    const nonce = newNonce();
    c.header('Content-Security-Policy', contentSecurityPolicy(nonce));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
    return c.html(injectMeta(indexHtml, { [TOKEN_META]: sessionToken, [NONCE_META]: nonce }));
  });
}
