import { expect, type Page, test } from '@playwright/test';

// 設定の画面でタグの名前と色を変え、削除する（FR-T13、DESIGN.md 4.10）

const unique = (base: string) => `${base}-${Date.now().toString(36)}`;

const detail = (page: Page) => page.getByRole('complementary', { name: '詳細' });
const taskRow = (page: Page, title: string) => page.locator('.task-row', { hasText: title });
const tagSection = (page: Page) => page.getByRole('region', { name: 'タグ' });
const nameInput = (page: Page, tag: string) =>
  tagSection(page).getByRole('textbox', { name: `「${tag}」の名前` });
const tagRow = (page: Page, tag: string) =>
  tagSection(page).locator('.tag-settings-row', {
    // has の中の位置は行から数えるので、ページからではなく入力欄だけで絞る
    has: page.getByRole('textbox', { name: `「${tag}」の名前` }),
  });

/** 今日のタスクを足し、詳細ペインでタグを付ける */
async function addTaskWithTag(page: Page, title: string, tag: string) {
  await page.goto('/');
  await page.getByLabel('今日のタスクを追加').fill(title);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: title, exact: true }).click();
  const input = detail(page).getByRole('combobox', { name: `「${title}」にタグを付ける` });
  await input.fill(tag);
  // 行のチップは保存を待たずに出る（楽観的更新）ので、画面を移る前に保存の応答を待つ
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'POST' && /\/api\/tasks\/[^/]+\/tags$/.test(res.url()),
  );
  await input.press('Enter');
  expect((await saved).ok()).toBe(true);
  await expect(taskRow(page, title).locator('.tag-chip')).toHaveText(tag);
}

test.describe('FR-T13 設定の画面でのタグの管理', () => {
  test('名前を変えると、付いているタスクの行のチップも変わる', async ({ page }) => {
    const title = unique('名前を変える');
    const tag = unique('旧名');
    const renamed = unique('新名');
    await addTaskWithTag(page, title, tag);
    await page.goto('/settings');
    await expect(tagRow(page, tag)).toContainText('1件のタスク');
    await nameInput(page, tag).fill(renamed);
    await nameInput(page, tag).press('Enter');
    await expect(nameInput(page, renamed)).toBeVisible();

    await page.goto('/');
    await expect(taskRow(page, title).locator('.tag-chip')).toHaveText(renamed);
  });

  test('ほかのタグと同じ名前には変えられず、理由が出る。Esc で元に戻る', async ({ page }) => {
    const first = unique('先のタグ');
    const second = unique('後のタグ');
    await addTaskWithTag(page, unique('タスク1'), first);
    await addTaskWithTag(page, unique('タスク2'), second);
    await page.goto('/settings');
    await nameInput(page, second).fill(first.toUpperCase());
    await nameInput(page, second).press('Enter');
    await expect(tagRow(page, second)).toContainText('すでにあります');
    await nameInput(page, second).press('Escape');
    await expect(nameInput(page, second)).toHaveValue(second);
  });

  test('色を変えると、行のチップの色も変わる', async ({ page }) => {
    const title = unique('色を変える');
    const tag = unique('色');
    await addTaskWithTag(page, title, tag);
    await page.goto('/settings');
    await tagRow(page, tag).getByRole('radio', { name: 'すみれ' }).check();
    await expect(tagRow(page, tag).locator('.tag-chip')).toHaveAttribute('data-color', 'plum');

    await page.goto('/');
    await expect(taskRow(page, title).locator('.tag-chip')).toHaveAttribute('data-color', 'plum');
  });

  test('削除は外れるタスクの数を示して確かめ、やめれば残り、削除すると行からも外れる', async ({
    page,
  }) => {
    const title = unique('タグを消す');
    const tag = unique('消す');
    await addTaskWithTag(page, title, tag);
    await page.goto('/settings');
    await tagRow(page, tag)
      .getByRole('button', { name: `「${tag}」を削除` })
      .click();
    await expect(tagRow(page, tag)).toContainText('付いている1件のタスクから外れます');
    await expect(tagRow(page, tag).getByRole('button', { name: 'やめる' })).toBeFocused();
    await tagRow(page, tag).getByRole('button', { name: 'やめる' }).click();
    await expect(tagRow(page, tag).getByRole('button', { name: `「${tag}」を削除` })).toBeVisible();

    await tagRow(page, tag)
      .getByRole('button', { name: `「${tag}」を削除` })
      .click();
    await tagRow(page, tag).getByRole('button', { name: '削除する' }).click();
    await expect(nameInput(page, tag)).toHaveCount(0);

    await page.goto('/');
    await expect(taskRow(page, title)).toBeVisible();
    await expect(taskRow(page, title).locator('.tag-chip')).toHaveCount(0);
  });

  test('NFR-13 別のタブでタグの名前を変えると、開いている設定の画面にも反映される', async ({
    page,
    context,
  }) => {
    const tag = unique('タブ');
    const renamed = unique('別のタブで変えた');
    await addTaskWithTag(page, unique('タブのタスク'), tag);
    await page.goto('/settings');
    await expect(nameInput(page, tag)).toBeVisible();

    const other = await context.newPage();
    await other.goto('/settings');
    await nameInput(other, tag).fill(renamed);
    await nameInput(other, tag).press('Enter');
    await expect(nameInput(other, renamed)).toBeVisible();

    await expect(nameInput(page, renamed)).toBeVisible();
    await other.close();
  });
});
