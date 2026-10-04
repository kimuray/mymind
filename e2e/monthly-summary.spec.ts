import { expect, type Page, test } from '@playwright/test';

// カレンダーの月次総括（FR-A06、FR-R05、偽のアダプタ）。すべてのテストが1つの DB を共有するので、月ごとに分ける

const monthOffset = (n: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - 5 * 60 * 60 * 1000),
  );
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthTitle = (ym: string) => `${Number(ym.slice(5))}月の総括`;

function patchSettings(page: Page, patch: Record<string, unknown>) {
  return page.evaluate(async (patch) => {
    const token =
      document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
      body: JSON.stringify(patch),
    });
    return res.status;
  }, patch);
}

test.describe('FR-A06 FR-R05 カレンダーの月次総括', () => {
  test('過ぎた月の総括を依頼すると、生成中を経て学び・傾向・提案が出る', async ({ page }) => {
    const ym = monthOffset(-3);
    await page.goto(`/calendar/${ym}`);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByRole('button', { name: monthTitle(ym) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const summary = detail.getByRole('region', { name: monthTitle(ym) });
    await expect(summary).toContainText('まだ総括をもらっていません');
    await summary.getByRole('button', { name: '総括をもらう' }).click();
    await expect(summary.getByRole('button', { name: 'キャンセル' })).toBeVisible();
    await expect(summary.getByRole('heading', { name: '学び' })).toBeVisible({ timeout: 15_000 });
    await expect(summary.getByRole('heading', { name: '来月への提案' })).toBeVisible();
    await expect(summary.getByText('途中経過')).toHaveCount(0);
  });

  test('今月の総括は途中経過として出し、提案は残りの日へのものになる', async ({ page }) => {
    const ym = monthOffset(0);
    await page.goto(`/calendar/${ym}`);
    const summary = page.getByRole('region', { name: monthTitle(ym) });
    const request = summary.getByRole('button', { name: /^(総括をもらう|もう一度もらう|再試行)$/ });
    await request.click();
    await expect(summary.getByRole('heading', { name: '残りの日への提案' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(summary.getByText('途中経過')).toBeVisible();
  });

  test('「依頼の前に毎回確認する」が有効なら、送信内容を見てから依頼する', async ({ page }) => {
    const ym = monthOffset(-4);
    await page.goto('/');
    expect(await patchSettings(page, { confirmBeforeRequest: true })).toBe(200);
    try {
      await page.goto(`/calendar/${ym}`);
      const detail = page.getByRole('complementary', { name: '詳細' });
      await detail.getByRole('button', { name: '総括をもらう' }).click();
      await expect(detail.getByRole('heading', { name: '送信内容' })).toBeVisible();
      await expect(detail.getByRole('region', { name: '集計値' })).toContainText('記録のある日');
      const requested = page
        .waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/jobs')
        .then((r) => r.postDataJSON() as { kind?: string; payloadHash?: string });
      await detail.getByRole('button', { name: 'この内容で総括をもらう' }).click();
      expect(await requested).toMatchObject({
        kind: 'monthly_summary',
        payloadHash: expect.any(String),
      });
    } finally {
      await patchSettings(page, { confirmBeforeRequest: false });
    }
  });

  test('まだ始まっていない月は、総括を依頼できない', async ({ page }) => {
    const ym = monthOffset(2);
    await page.goto(`/calendar/${ym}`);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail).toContainText('まだ始まっていない月です');
    await expect(detail.getByRole('button', { name: '総括をもらう' })).toHaveCount(0);
  });

  test('日付を選ぶと「この日」の記録に切り替わり、総括のタブへ戻れる', async ({ page }) => {
    const ym = monthOffset(-3);
    await page.goto(`/calendar/${ym}/${ym}-05`);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByRole('button', { name: 'この日' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await detail.getByRole('button', { name: monthTitle(ym) }).click();
    await expect(detail.getByRole('region', { name: monthTitle(ym) })).toBeVisible();
  });
});
