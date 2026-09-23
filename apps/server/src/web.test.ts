import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { contentSecurityPolicy, createWebRoutes, injectMeta } from './web';

const PORT = 4820;
const HOST = { Host: `127.0.0.1:${PORT}` };
let dist: string;

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'mymind-web-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><html><head><title>mymind</title></head><body><div id="root"></div></body></html>',
  );
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.error("app")');
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

const buildApp = () =>
  createApp(
    { ports: [PORT], sessionToken: 'tok"en' },
    undefined,
    createWebRoutes({ distDir: dist, sessionToken: 'tok"en', newNonce: () => 'n0nce' }),
  );

describe('NFR-02 本番の画面の配信', () => {
  it('index.html にセッショントークンとノンスを埋め込んで返す', async () => {
    const res = await buildApp().request('/', { headers: HOST });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="mymind-token" content="tok&quot;en">');
    expect(html).toContain('<meta name="mymind-csp-nonce" content="n0nce">');
  });

  it('画面の URL（今日以外）にも index.html を返し、画面側のルーターに任せる', async () => {
    const res = await buildApp().request('/calendar/2026-09/2026-09-22', { headers: HOST });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it('同梱のファイルを配信する', async () => {
    const res = await buildApp().request('/assets/app.js', { headers: HOST });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('console.error');
  });

  it('API の未定義のパスには、画面ではなく 404 を返す', async () => {
    const res = await buildApp().request('/api/unknown', { headers: HOST });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<div id="root">');
  });

  it('画面も Host の検証の内側にある（DNS リバインディング対策）', async () => {
    const res = await buildApp().request('/', { headers: { Host: `attacker.example:${PORT}` } });
    expect(res.status).toBe(403);
  });

  it('ビルドがなければ画面を配信しない（開発時は Vite が配信する）', () => {
    expect(createWebRoutes({ distDir: join(dist, 'missing'), sessionToken: 't' })).toBeNull();
  });
});

describe('ADR-0007 本番の CSP', () => {
  it('画面の応答に、ノンス付きの厳格な CSP を付ける', async () => {
    const res = await buildApp().request('/', { headers: HOST });
    expect(res.headers.get('Content-Security-Policy')).toBe(contentSecurityPolicy('n0nce'));
  });

  it('スクリプトは同梱のファイルだけ、スタイルはノンス付きのものだけを許す', () => {
    const csp = contentSecurityPolicy('abc');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'nonce-abc'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });

  it('meta タグは </head> の直前に差し込む', () => {
    expect(injectMeta('<head><title>x</title></head>', { a: '1' })).toBe(
      '<head><title>x</title><meta name="a" content="1"></head>',
    );
  });
});

describe('NFR-02 開発時の Vite のポート', () => {
  it('Vite のポートを許可リストに加えると、Vite 経由の状態変更を受け付ける', async () => {
    const app = createApp({ ports: [PORT, 5173], sessionToken: 't' });
    app.post('/api/ping', (c) => c.json({ ok: true }));
    const res = await app.request('/api/ping', {
      method: 'POST',
      headers: {
        Host: '127.0.0.1:5173',
        Origin: 'http://127.0.0.1:5173',
        'Sec-Fetch-Site': 'same-origin',
        'X-Mymind-Token': 't',
      },
    });
    expect(res.status).toBe(200);
  });
});
