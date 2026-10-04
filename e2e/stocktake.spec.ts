import { expect, type Page, test } from '@playwright/test';

// 棚卸し（FR-R06、#135 の決定）。E2E のサーバーは実際の時刻で動くので、30日前に触れたタスクは作れない。
// 設定の日数を 0（バックログのすべてが対象）にして確かめ、最後に初期値に戻す

/** 画面の中から設定を変える（状態を変える API にはトークンが要る） */
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

const uniqueTitle = (base: string) => `${base}-${Date.now().toString(36)}`;

test.describe('FR-R06 棚卸し', () => {
  test('設定の日数で対象を選び、今週やる・残す・中止を1件ずつ判断できる', async ({ page }) => {
    const thisWeek = uniqueTitle('棚卸しで今週やる');
    const drop = uniqueTitle('棚卸しで中止する');

    await page.goto('/settings');
    const days = page.getByRole('spinbutton', { name: '棚卸しの対象にする日数' });
    await expect(days).toHaveValue('30');
    try {
      await days.fill('0');
      await expect.poll(async () => (await page.request.get('/api/settings')).status()).toBe(200);

      await page.goto('/backlog');
      for (const title of [thisWeek, drop]) {
        await page.getByLabel('バックログに追加').fill(title);
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
      }
      // 入力欄から抜けて、数字のキーを判断に使えるようにする
      await page.keyboard.press('Escape');
      const panel = page.getByRole('region', { name: '棚卸し' });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('0日以上触れていないタスクを1件ずつ判断');

      // ほかのテストが残したタスクは「残す」で後ろへ回す（0日の設定では、残しても対象のまま後ろに並ぶ）
      const card = panel.locator('.stocktake-card h3');
      for (let i = 0; i < 100 && (await card.textContent()) !== thisWeek; i++) {
        const before = await card.textContent();
        await page.keyboard.press('2');
        await expect(card).not.toHaveText(before ?? '');
      }
      await expect(card).toHaveText(thisWeek);
      await expect(panel).toContainText('一度も着手されていません');

      await page.keyboard.press('1');
      await expect(card).toHaveText(drop);
      await panel.getByRole('button', { name: /^中止にする/ }).click();
      await expect(card).not.toHaveText(drop);

      // 今週やるは今日の計画に入り、中止はバックログから消える
      await expect(page.getByRole('button', { name: thisWeek, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: drop, exact: true })).toHaveCount(0);
      await page.goto('/');
      await expect(
        page.getByRole('button', { name: new RegExp(`^${thisWeek}：未着手`) }),
      ).toBeVisible();
    } finally {
      await patchSettings(page, { reviewAfterDays: 30 });
    }
  });

  test('初期値の30日では、今日追加したタスクは対象にならない', async ({ page }) => {
    const title = uniqueTitle('追加したばかり');
    await page.goto('/backlog');
    await page.getByLabel('バックログに追加').fill(title);
    await page.keyboard.press('Enter');
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toContainText('今日');
    await expect(row).not.toContainText('棚卸しの対象');
  });
});
