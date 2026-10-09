import { expect, type Page, test } from '@playwright/test';

// タグごとの集計（FR-R08、DESIGN.md 4.24）。E2E のサーバーは実際の時刻で動くので、今日の操作で確かめる

const unique = (base: string) => `${base}-${Date.now().toString(36)}`;

/** 今の業務日（Asia/Tokyo、5時で切り替え。サーバーの初期値と同じ）の月 */
const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
    .format(new Date(Date.now() - 5 * 60 * 60 * 1000))
    .slice(0, 7);

/** 今日のタスクを足してタグを付け、着手してから完了にする */
async function completeTaggedTask(page: Page, title: string, tag: string) {
  await page.goto('/');
  await page.getByLabel('今日のタスクを追加').fill(title);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: title, exact: true }).click();
  const input = page
    .getByRole('complementary', { name: '詳細' })
    .getByRole('combobox', { name: `「${title}」にタグを付ける` });
  await input.fill(tag);
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'POST' && /\/api\/tasks\/[^/]+\/tags$/.test(res.url()),
  );
  await input.press('Enter');
  expect((await saved).ok()).toBe(true);
  await page.getByRole('button', { name: new RegExp(`^${title}：未着手`) }).click();
  await page.getByRole('button', { name: new RegExp(`^${title}：着手中`) }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^${title}：完了`) })).toBeVisible();
}

const statRow = (page: Page, caption: RegExp, tag: string) =>
  page.getByRole('table', { name: caption }).getByRole('row', { name: new RegExp(tag) });

test.describe('FR-R08 タグごとの集計', () => {
  test('タイムラインに、表示期間のタグごとの完了の数と着手中の日数が出る', async ({ page }) => {
    const tag = unique('集計');
    await completeTaggedTask(page, unique('集計のタスク'), tag);
    await page.goto('/timeline');
    const row = statRow(page, /^タグごと/, tag);
    await expect(row.getByRole('cell')).toHaveText(['1件', '1日', '0日']);
  });

  test('カレンダーにその月のタグごとの完了の数、総括にタグごとの内訳が出る', async ({ page }) => {
    const tag = unique('月の集計');
    await completeTaggedTask(page, unique('月の集計のタスク'), tag);
    await page.goto(`/calendar/${thisMonth()}`);
    const completed = page.getByRole('list', { name: /のタグごとの完了$/ });
    await expect(completed.getByRole('listitem').filter({ hasText: tag })).toContainText('1件');

    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByRole('button', { name: /の総括$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const row = detail
      .getByRole('table', { name: /のタグごと$/ })
      .getByRole('row', { name: new RegExp(tag) });
    await expect(row.getByRole('cell')).toHaveText(['1件', '1日', '0日']);
  });
});
