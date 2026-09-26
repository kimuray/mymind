import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

// 送信内容のプレビュー（FR-A12、偽のアダプタ）。振り返りの画面はまだないので、今日の計画のタスクを送る内容として使い、
// 画面に埋め込まれたトークンで API を呼ぶ。偽のアダプタが受け取った入力は、エージェントの入出力のログで確かめる

// playwright.config.ts の MYMIND_DATA_DIR と同じ場所
const agentLogDir = fileURLToPath(new URL('../.data/e2e/logs/agent', import.meta.url));

type Preview = { payload: unknown; payloadHash: string; charCount: number };

/** 今の業務日（Asia/Tokyo、5時で切り替え。サーバーの初期値と同じ） */
const currentDay = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - 5 * 60 * 60 * 1000),
  );

async function addTodayTask(page: Page, title: string) {
  await page.getByLabel('今日のタスクを追加').fill(title);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: new RegExp(`${title}：未着手`) })).toBeVisible();
}

/** 画面の中から API を呼ぶ（状態を変える API にはトークンが要る） */
function callApi(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const token =
        document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    { path, body },
  );
}

const preview = async (page: Page, period: string) => {
  const res = await callApi(page, '/api/agent-input/preview', { kind: 'daily_feedback', period });
  expect(res.status).toBe(200);
  return res.body as unknown as Preview;
};

test.describe('FR-A12 送信内容のプレビュー', () => {
  test('プレビューの内容と、偽のアダプタが受け取った入力が一致する', async ({ page }) => {
    const day = currentDay();
    await page.goto('/');
    await addTodayTask(page, 'プレビューで確かめるタスク');

    const shown = await preview(page, day);
    expect(JSON.stringify(shown.payload)).toContain('プレビューで確かめるタスク');
    const res = await callApi(page, '/api/jobs', {
      kind: 'daily_feedback',
      period: day,
      payloadHash: shown.payloadHash,
    });
    expect(res.status).toBe(202);
    const jobId = (res.body['job'] as { id: string }).id;

    await expect
      .poll(
        async () =>
          page.evaluate(
            async (id) =>
              ((await (await fetch(`/api/jobs/${id}`)).json()) as { job: { status: string } }).job
                .status,
            jobId,
          ),
        { timeout: 15_000 },
      )
      .toBe('succeeded');

    // プロンプトの本文にも <data> の説明があるので、最後の <data> から読む
    const log = JSON.parse(readFileSync(`${agentLogDir}/${day}/${jobId}.json`, 'utf8')) as {
      input: string;
      charCount: number;
    };
    const sent = log.input.slice(
      log.input.lastIndexOf('<data>\n') + 7,
      log.input.lastIndexOf('\n</data>'),
    );
    expect(JSON.parse(sent)).toEqual(shown.payload);
    expect(log.charCount).toBe(shown.charCount);
  });

  test('プレビューの後に送る内容を変えて依頼すると、再確認を求められる', async ({ page }) => {
    const day = currentDay();
    await page.goto('/');
    await addTodayTask(page, '確認の前からあるタスク');
    const first = await preview(page, day);

    await addTodayTask(page, '確認の後に足したタスク');
    const stale = await callApi(page, '/api/jobs', {
      kind: 'daily_feedback',
      period: day,
      payloadHash: first.payloadHash,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'PREVIEW_STALE' } });

    // 確かめ直した内容なら依頼できる
    const second = await preview(page, day);
    expect(second.payloadHash).not.toBe(first.payloadHash);
    expect(JSON.stringify(second.payload)).toContain('確認の後に足したタスク');
    const ok = await callApi(page, '/api/jobs', {
      kind: 'daily_feedback',
      period: day,
      payloadHash: second.payloadHash,
    });
    expect(ok.status).toBe(202);
  });

  test('設定「依頼の前に毎回確認する」を切り替えると、開き直しても残る', async ({ page }) => {
    const saved = () =>
      page.waitForResponse(
        (r) => r.url().endsWith('/api/settings') && r.request().method() === 'PATCH' && r.ok(),
      );
    const toggle = () => page.getByRole('checkbox', { name: /依頼の前に毎回確認する/ });
    await page.goto('/settings');
    await expect(toggle()).not.toBeChecked();
    await Promise.all([saved(), toggle().check()]);
    await page.reload();
    await expect(toggle()).toBeChecked();
    // 他のテストに影響しないよう戻す
    await Promise.all([saved(), toggle().uncheck()]);
    await expect(toggle()).not.toBeChecked();
  });
});
