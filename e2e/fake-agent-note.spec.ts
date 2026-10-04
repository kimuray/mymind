import { expect, test } from '@playwright/test';

// E2E のサーバーは MYMIND_AGENT=fake で動く。エージェントの選択が使われないことを、画面で伝える（FR-A07、#144）
const NOTE = '開発用の偽のアダプタを使っているため、この選択は使われません';

test.describe('FR-A07 偽のアダプタで動いているときの注記', () => {
  test('設定の既定のエージェントに、選択が使われないことを添える', async ({ page }) => {
    await page.goto('/settings');
    const select = page.getByRole('combobox', { name: '既定のエージェント' });
    await expect(select).toHaveAccessibleDescription(NOTE);
    await expect(page.getByText(NOTE)).toBeVisible();
  });

  test('振り返りのエージェントの選択には、チップと読み上げで伝える', async ({ page }) => {
    await page.goto('/reflection');
    const select = page.getByRole('combobox', { name: 'エージェント' });
    await expect(select).toHaveAccessibleDescription(NOTE);
    await expect(page.locator('.agent-select .chip')).toHaveText(/偽のアダプタ/);
  });

  test('カレンダーの詳細ペインのエージェントの選択にも、チップと読み上げで伝える', async ({
    page,
  }) => {
    // 今日を空白日にしないよう、今日の計画にタスクを足してから開く
    await page.goto('/');
    await page.getByLabel('今日のタスクを追加').fill(`注記の確かめ-${Date.now().toString(36)}`);
    await page.keyboard.press('Enter');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
      new Date(Date.now() - 5 * 60 * 60 * 1000),
    );
    await page.goto(`/calendar/${today.slice(0, 7)}/${today}`);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(
      detail.getByRole('combobox', { name: 'エージェント' }),
    ).toHaveAccessibleDescription(NOTE);
    await expect(detail.locator('.agent-select .chip')).toHaveText(/偽のアダプタ/);
  });
});
