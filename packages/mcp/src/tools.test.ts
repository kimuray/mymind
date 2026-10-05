import { describe, expect, it } from 'vitest';
import { type ApiResult, createApiClient } from './client';
import { createTools } from './tools';

/** 呼ばれた URL を記録し、決まった応答を返す偽の fetch */
function fakeApi(
  respond: (url: URL) => Response | Promise<Response> = () => Response.json({ ok: 1 }),
) {
  const urls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    urls.push(url);
    return respond(url);
  }) as typeof fetch;
  return {
    api: createApiClient({ baseUrl: 'http://127.0.0.1:4820', token: 't' }, fetchImpl),
    urls,
  };
}

const text = (r: { content: { text: string }[] }) => r.content[0]?.text ?? '';

describe('FR-M02 MCP の読み取りの道具', () => {
  it('get_day は指定した日の API を呼び、応答をそのまま返す', async () => {
    const { api, urls } = fakeApi(() => Response.json({ day: '2026-09-23', tasks: [] }));
    const result = await createTools(api).get_day.run({ day: '2026-09-23' });
    expect(urls[0]?.pathname).toBe('/api/days/2026-09-23');
    expect(JSON.parse(text(result))).toEqual({ day: '2026-09-23', tasks: [] });
    expect(result.isError).toBeUndefined();
  });

  it('get_day で日を省くと、今日の業務日（5時で切り替え）を使う', async () => {
    const { api, urls } = fakeApi();
    // 2026-09-23 04:59（日本時間）は、前日の業務日
    await createTools(api, () => new Date('2026-09-22T19:59:00Z')).get_day.run({});
    expect(urls[0]?.pathname).toBe('/api/days/2026-09-22');
  });

  it('ほかの道具も、それぞれの読み取りの API を呼ぶ', async () => {
    const { api, urls } = fakeApi();
    const tools = createTools(api);
    await tools.get_backlog.run();
    await tools.get_timeline.run({ from: '2026-09-10', to: '2026-09-23' });
    await tools.get_month.run({ ym: '2026-09' });
    await tools.search_tasks.run({ q: '企画 書' });
    expect(urls.map((u) => `${u.pathname}${u.search}`)).toEqual([
      '/api/backlog',
      '/api/timeline?from=2026-09-10&to=2026-09-23',
      '/api/months/2026-09',
      '/api/tasks/search?q=%E4%BC%81%E7%94%BB+%E6%9B%B8',
    ]);
  });

  it('書き換える道具は出さない（FR-M01）', () => {
    const { api } = fakeApi();
    expect(Object.keys(createTools(api)).sort()).toEqual([
      'get_backlog',
      'get_day',
      'get_month',
      'get_timeline',
      'search_tasks',
    ]);
  });

  it('API のエラーは、その文をエラーとして返す', async () => {
    const { api } = fakeApi(() =>
      Response.json({ error: { message: '期間は14日までにしてください' } }, { status: 400 }),
    );
    const result = await createTools(api).get_timeline.run({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(result).toEqual({
      content: [{ type: 'text', text: '期間は14日までにしてください' }],
      isError: true,
    });
  });

  it('サーバーが動いていなければ、そのことを返す（FR-M03）', async () => {
    const { api } = fakeApi(() => {
      throw new TypeError('fetch failed');
    });
    const result: { isError?: boolean; content: { text: string }[] } =
      await createTools(api).get_backlog.run();
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('サーバー（http://127.0.0.1:4820）が動いていません');
  });
});

describe('FR-M03 サーバーへのつなぎ方', () => {
  it('セッショントークンを付けて呼ぶ', async () => {
    let token: string | null = null;
    const fetchImpl = (async (_: unknown, init?: RequestInit) => {
      token = new Headers(init?.headers).get('X-Mymind-Token');
      return Response.json({});
    }) as typeof fetch;
    const result: ApiResult = await createApiClient(
      { baseUrl: 'http://127.0.0.1:4820', token: 'secret' },
      fetchImpl,
    ).get('/backlog');
    expect(result.ok).toBe(true);
    expect(token).toBe('secret');
  });
});
