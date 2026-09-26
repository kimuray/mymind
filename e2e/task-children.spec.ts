import { expect, type Page, test } from '@playwright/test';

// 詳細ペインから子タスクを追加する（FR-T02、#89）。E2E のデータは実行の中で共有されるので、タスク名はテストごとに分ける

const row = (page: Page, title: string) =>
  page.locator('.task-row', { has: page.getByRole('button', { name: new RegExp(`^${title}：`) }) });

const detail = (page: Page) => page.getByRole('complementary', { name: '詳細' });

async function addAndSelect(page: Page, inputLabel: string, title: string) {
  const input = page.getByLabel(inputLabel);
  await input.fill(title);
  await input.press('Enter');
  await row(page, title).locator('.task-title').click();
  await expect(detail(page).getByRole('heading', { name: title })).toBeVisible();
}

test.describe('FR-T02 詳細ペインから子タスクを追加する', () => {
  test('今日の画面で親の詳細から追加すると、今日の計画に親の子として入る', async ({ page }) => {
    await page.goto('/');
    await addAndSelect(page, '今日のタスクを追加', '詳細から子を持つ親');

    const childInput = detail(page).getByLabel('「詳細から子を持つ親」の子タスクを追加');
    await childInput.fill('詳細から足した子1');
    await childInput.press('Enter');
    await childInput.fill('詳細から足した子2');
    await childInput.press('Enter');

    for (const title of ['詳細から足した子1', '詳細から足した子2']) {
      await expect(row(page, title)).toHaveAttribute('data-depth', '1');
      await expect(
        detail(page).getByRole('region', { name: '子タスク' }).getByText(title),
      ).toBeVisible();
    }
    // 続けて足せるよう、親を選んだままにする
    await expect(row(page, '詳細から子を持つ親')).toHaveAttribute('data-selected', 'true');
  });

  test('子タスクの詳細には、子を追加する欄を出さない（2階層まで）', async ({ page }) => {
    await page.goto('/');
    await addAndSelect(page, '今日のタスクを追加', '孫を作らせない親');
    const childInput = detail(page).getByLabel('「孫を作らせない親」の子タスクを追加');
    await childInput.fill('孫を作らせない子');
    await childInput.press('Enter');

    await row(page, '孫を作らせない子').locator('.task-title').click();
    await expect(detail(page).getByRole('heading', { name: '孫を作らせない子' })).toBeVisible();
    await expect(detail(page).getByRole('region', { name: '子タスク' })).toHaveCount(0);
  });

  test('バックログで親の詳細から追加すると、バックログの親のまとまりに入る', async ({ page }) => {
    await page.goto('/backlog');
    await addAndSelect(page, 'バックログに追加', 'バックログの親');
    const childInput = detail(page).getByLabel('「バックログの親」の子タスクを追加');
    await childInput.fill('バックログで足した子');
    await childInput.press('Enter');

    await expect(
      page.getByRole('region', { name: 'バックログの親' }).getByRole('button', {
        name: /^バックログで足した子：/,
      }),
    ).toBeVisible();
  });
});
