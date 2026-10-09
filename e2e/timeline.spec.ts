import { expect, test } from '@playwright/test';

// タイムライン（FR-R01〜R03、偽のアダプタ）。E2E のサーバーは実際の時刻で動くので、今日の操作で確かめる

const uniqueTitle = (base: string) => `${base}-${Date.now().toString(36)}`;

test.describe('NFR-06 タイムラインの面', () => {
  test('調子のレーンは地の色のくぼみで、タスクの行には縞模様を付けない', async ({ page }) => {
    await page.goto('/timeline');
    const lane = page.locator('.timeline-lane');
    // 調子のレーンは --neu-inset-1 のくぼみ（DESIGN.md 4.8、ADR-0018）
    await expect(lane).toHaveCSS('background-color', 'rgb(228, 233, 240)');
    await expect(lane).toHaveCSS('box-shadow', /3px 3px 6px 0px inset/);
    const rows = page.locator('.timeline-task');
    const count = await rows.count();
    for (let i = 0; i < Math.min(count, 4); i++) {
      await expect(rows.nth(i)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
  });
});

test.describe('FR-R01 FR-R02 FR-R03 タイムライン', () => {
  test('着手したタスクが横棒で出て、行を選ぶと内訳が出る', async ({ page }) => {
    const title = uniqueTitle('タイムラインで見る');
    await page.goto('/');
    await page.getByLabel('今日のタスクを追加').fill(title);
    await page.keyboard.press('Enter');
    // 状態のアイコンを押して着手中にする
    await page.getByRole('button', { name: new RegExp(`^${title}：未着手`) }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^${title}：着手中`) })).toBeVisible();

    await page.goto('/timeline');
    await expect(page.getByRole('heading', { name: 'タイムライン', level: 1 })).toBeVisible();
    const row = page.getByRole('button', { name: new RegExp(`^${title}：着手中`) });
    await expect(row).toBeVisible();
    await expect(page.getByRole('img', { name: /：FBなし$/ }).first()).toBeVisible();

    await row.click();
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByRole('heading', { name: title })).toBeVisible();
    await expect(detail).toContainText('着手 → 継続中（1日目）');
    await expect(detail.locator('.timeline-counts div').first()).toContainText('着手中1日');
  });

  test('1週間と2週間を切り替え、前の期間へ移って戻れる', async ({ page }) => {
    await page.goto('/timeline');
    const range = page.locator('.timeline-range');
    const twoWeeks = await range.textContent();
    await page.getByRole('button', { name: '1週間' }).click();
    await expect(page.getByRole('button', { name: '1週間' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(range).not.toHaveText(twoWeeks ?? '');
    await expect(page.locator('.timeline-date')).toHaveCount(7);

    const thisWeek = await range.textContent();
    await expect(page.getByRole('button', { name: '次の期間' })).toBeDisabled();
    await page.getByRole('button', { name: '前の期間' }).click();
    await expect(range).not.toHaveText(thisWeek ?? '');
    await page.getByRole('button', { name: '次の期間' }).click();
    await expect(range).toHaveText(thisWeek ?? '');
  });

  test('J で行を選び、Esc で選択を外す', async ({ page }) => {
    const title = uniqueTitle('キーで選ぶ');
    await page.goto('/');
    await page.getByLabel('今日のタスクを追加').fill(title);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: new RegExp(`^${title}：未着手`) }).click();

    await page.goto('/timeline');
    await page.locator('body').click();
    await page.keyboard.press('j');
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByRole('region')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toContainText('タスクの行を選ぶと、期間の内訳が表示されます');
  });
});
