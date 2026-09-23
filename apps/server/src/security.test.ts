import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { TOKEN_HEADER } from './security';

const PORT = 4820;
const TOKEN = 'test-session-token';
const ORIGIN = `http://127.0.0.1:${PORT}`;

function buildApp() {
  const app = createApp({ ports: [PORT], sessionToken: TOKEN });
  app.get('/api/items', (c) => c.json({ items: [] }));
  app.post('/api/items', (c) => c.json({ created: true }, 201));
  return app;
}

/** 同じオリジンの画面から送られる、正しい状態変更リクエストのヘッダー */
const validWrite = {
  Host: `127.0.0.1:${PORT}`,
  'Sec-Fetch-Site': 'same-origin',
  Origin: ORIGIN,
  [TOKEN_HEADER]: TOKEN,
};

const post = (headers: Record<string, string>) =>
  buildApp().request('/api/items', { method: 'POST', headers });

describe('NFR-02 Host の検証', () => {
  it.each([`127.0.0.1:${PORT}`, `localhost:${PORT}`])('Host が %s なら受け付ける', async (host) => {
    const res = await buildApp().request('/api/items', { headers: { Host: host } });
    expect(res.status).toBe(200);
  });

  it.each([
    ['別のドメイン（DNS リバインディング）', `attacker.example:${PORT}`],
    ['別のポート', '127.0.0.1:9999'],
    ['ポートなし', '127.0.0.1'],
  ])('%s の Host は拒否する', async (_, host) => {
    const res = await buildApp().request('/api/items', { headers: { Host: host } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden_host' } });
  });

  it('Host がないリクエストは拒否する', async () => {
    const res = await buildApp().request('/api/items');
    expect(res.status).toBe(403);
  });

  it('状態を変えないリクエストには、トークンを求めない', async () => {
    const res = await buildApp().request('/api/items', {
      headers: { Host: `127.0.0.1:${PORT}`, 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(200);
  });
});

describe('NFR-02 状態を変えるリクエストの検証', () => {
  it('同じオリジンから正しいトークンで送られたリクエストは受け付ける', async () => {
    const res = await post(validWrite);
    expect(res.status).toBe(201);
  });

  it('localhost で開いた画面からのリクエストも受け付ける', async () => {
    const res = await post({
      ...validWrite,
      Host: `localhost:${PORT}`,
      Origin: `http://localhost:${PORT}`,
    });
    expect(res.status).toBe(201);
  });

  it.each(['cross-site', 'same-site', 'none'])(
    'Sec-Fetch-Site が %s なら拒否する',
    async (site) => {
      const res = await post({ ...validWrite, 'Sec-Fetch-Site': site });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: 'forbidden_fetch_site' } });
    },
  );

  it('Sec-Fetch-Site がないリクエストは拒否する', async () => {
    const { 'Sec-Fetch-Site': _, ...headers } = validWrite;
    expect((await post(headers)).status).toBe(403);
  });

  it('外部のオリジンからのリクエストは拒否する', async () => {
    const res = await post({ ...validWrite, Origin: 'https://attacker.example' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden_origin' } });
  });

  it('Origin がないリクエストは拒否する', async () => {
    const { Origin: _, ...headers } = validWrite;
    expect((await post(headers)).status).toBe(403);
  });

  it('トークンが違うリクエストは拒否する', async () => {
    const res = await post({ ...validWrite, [TOKEN_HEADER]: 'wrong-token' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden_token' } });
  });

  it('トークンがないリクエストは拒否する', async () => {
    const { [TOKEN_HEADER]: _, ...headers } = validWrite;
    expect((await post(headers)).status).toBe(403);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('%s もトークンなしでは拒否する', async (method) => {
    const { [TOKEN_HEADER]: _, ...headers } = validWrite;
    const res = await buildApp().request('/api/items', { method, headers });
    expect(res.status).toBe(403);
  });
});
