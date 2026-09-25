import { expect, type Page, test } from '@playwright/test';

// FB の依頼の流れ（偽のアダプタ、MYMIND_AGENT=fake）。画面の依頼ボタンは振り返りの画面の issue で作るので、
// ここでは画面に埋め込まれたトークンを使って API を呼び、SSE（GET /api/events）で進み具合を受け取る

type Watched = { statuses: string[]; jobId: string };

/** SSE を購読してから FB を依頼し、ジョブの状態の移り変わりを集める */
async function requestFeedback(page: Page, period: string, cancelWhenRunning = false) {
  return page.evaluate(
    async ({ period, cancelWhenRunning }) => {
      const token =
        document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
      const headers = { 'Content-Type': 'application/json', 'X-Mymind-Token': token };
      const source = new EventSource('/api/events');
      await new Promise((resolve) => source.addEventListener('open', resolve, { once: true }));

      // ジョブは依頼の応答より先に実行中になるので、依頼の前から通知を集めておく
      const seen: { id: string; status: string }[] = [];
      let jobId: string | null = null;
      let cancelled = false;
      let finish: () => void = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const check = () => {
        if (jobId === null) return;
        const mine = seen.filter((e) => e.id === jobId).map((e) => e.status);
        if (cancelWhenRunning && !cancelled && mine.includes('running')) {
          cancelled = true;
          fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST', headers });
        }
        if (mine.some((s) => ['succeeded', 'failed', 'cancelled'].includes(s))) finish();
      };
      source.addEventListener('job.updated', (e) => {
        const data = JSON.parse((e as MessageEvent<string>).data) as {
          job: { id: string; status: string };
        };
        seen.push({ id: data.job.id, status: data.job.status });
        check();
      });

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: 'daily_feedback', period }),
      });
      jobId = ((await res.json()) as { job: { id: string } }).job.id;
      check();
      await finished;
      source.close();
      const statuses = seen.filter((e) => e.id === jobId).map((e) => e.status);
      return { statuses, jobId } satisfies Watched;
    },
    { period, cancelWhenRunning },
  );
}

test.describe('FR-A01 / FR-A08 FB の依頼（偽のアダプタ）', () => {
  test('依頼すると、生成中を経て完了し、FB を取得できる', async ({ page }) => {
    await page.goto('/');
    const { statuses } = await requestFeedback(page, '2026-01-05');
    expect(statuses).toEqual(['queued', 'running', 'succeeded']);

    const feedbacks = await page.evaluate(async () =>
      (await fetch('/api/feedbacks?scope=daily&period=2026-01-05')).json(),
    );
    expect(feedbacks).toMatchObject({
      feedbacks: [{ agent: 'fake', content: { condition: { level: 3 } } }],
    });
  });

  test('生成中にキャンセルすると、キャンセルになり FB は残らない', async ({ page }) => {
    await page.goto('/');
    const { statuses } = await requestFeedback(page, '2026-01-06', true);
    expect(statuses).toEqual(['queued', 'running', 'cancelled']);
    const feedbacks = await page.evaluate(async () =>
      (await fetch('/api/feedbacks?scope=daily&period=2026-01-06')).json(),
    );
    expect(feedbacks).toEqual({ feedbacks: [] });
  });
});
