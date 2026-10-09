import { expect, type Page, test } from '@playwright/test';

// 今日・バックログをタグで絞り込む（FR-T14、DESIGN.md 4.23）

const unique = (base: string) => `${base}-${Date.now().toString(36)}`;

const detail = (page: Page) => page.getByRole('complementary', { name: '詳細' });
const taskButton = (page: Page, title: string) =>
  page.getByRole('button', { name: title, exact: true });
const filterSelect = (page: Page) => page.getByRole('combobox', { name: 'タグで絞り込む' });

async function select(page: Page, title: string) {
  await taskButton(page, title).click();
  await expect(detail(page)).toContainText(title);
}

/** 選んでいるタスクにタグを付け、保存の応答を待つ（行のチップは保存を待たずに出るため） */
async function attachTag(page: Page, title: string, tag: string) {
  const input = detail(page).getByRole('combobox', { name: `「${title}」にタグを付ける` });
  await input.fill(tag);
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'POST' && /\/api\/tasks\/[^/]+\/tags$/.test(res.url()),
  );
  await input.press('Enter');
  expect((await saved).ok()).toBe(true);
}

async function addToday(page: Page, title: string) {
  await page.getByLabel('今日のタスクを追加').fill(title);
  await page.keyboard.press('Enter');
  await expect(taskButton(page, title)).toBeVisible();
}

test.describe('FR-T14 タグでの絞り込み', () => {
  test('今日の一覧をタグで絞り込み、解除すると戻る', async ({ page }) => {
    const tagged = unique('付いたタスク');
    const untagged = unique('付いていないタスク');
    const tag = unique('絞る');
    await page.goto('/');
    await addToday(page, tagged);
    await addToday(page, untagged);
    await select(page, tagged);
    await attachTag(page, tagged, tag);

    await filterSelect(page).selectOption({ label: tag });
    await expect(taskButton(page, tagged)).toBeVisible();
    await expect(taskButton(page, untagged)).toHaveCount(0);
    await expect(page.locator('.tag-filter-status')).toContainText(/で絞り込み中（1 \/ \d+ 件）/);

    await page.locator('.tag-filter-status').getByRole('button', { name: '解除' }).click();
    await expect(taskButton(page, untagged)).toBeVisible();
    await expect(page.locator('.tag-filter-status')).toHaveCount(0);
  });

  test('コマンドパレットから絞り込み、解除できる', async ({ page }) => {
    const tagged = unique('パレットのタスク');
    const untagged = unique('パレットの外');
    const tag = unique('パレット');
    await page.goto('/backlog');
    await page.getByLabel('バックログに追加').fill(tagged);
    await page.keyboard.press('Enter');
    await page.getByLabel('バックログに追加').fill(untagged);
    await page.keyboard.press('Enter');
    await select(page, tagged);
    await attachTag(page, tagged, tag);
    // 付けたタグは、読み直さなくても絞り込みの候補に出る
    await expect(filterSelect(page).locator('option', { hasText: tag })).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'コマンドパレット' });
    await palette.getByRole('combobox', { name: '操作を検索' }).fill(tag);
    await expect(palette.getByRole('option', { selected: true })).toHaveText(
      `タグで絞り込む：${tag}`,
    );
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(taskButton(page, untagged)).toHaveCount(0);
    await expect(taskButton(page, tagged)).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');
    await palette.getByRole('combobox', { name: '操作を検索' }).fill('絞り込みを解除');
    await page.keyboard.press('Enter');
    await expect(taskButton(page, untagged)).toBeVisible();
  });

  test('子にだけ付いていれば子だけを親の名前のラベル付きで出し、付いていない子と親は出さない', async ({
    page,
  }) => {
    const parent = unique('親');
    const taggedChild = unique('付いた子');
    const otherChild = unique('付いていない子');
    const tag = unique('子のタグ');
    await page.goto('/');
    await addToday(page, parent);
    await select(page, parent);
    for (const child of [taggedChild, otherChild]) {
      await detail(page).getByLabel(`「${parent}」の子タスクを追加`).fill(child);
      await page.keyboard.press('Enter');
      await expect(taskButton(page, child)).toBeVisible();
    }
    await select(page, taggedChild);
    await attachTag(page, taggedChild, tag);

    await filterSelect(page).selectOption({ label: tag });
    const row = page.locator('.task-row', { hasText: taggedChild });
    await expect(row).toBeVisible();
    await expect(row.locator('.task-parent')).toHaveText(parent);
    await expect(taskButton(page, parent)).toHaveCount(0);
    await expect(taskButton(page, otherChild)).toHaveCount(0);
  });

  test('絞り込みで見えなくなったタスクを選んでいたら、詳細ペインを閉じる', async ({ page }) => {
    const tagged = unique('残るタスク');
    const hidden = unique('隠れるタスク');
    const tag = unique('閉じる');
    await page.goto('/');
    await addToday(page, tagged);
    await addToday(page, hidden);
    await select(page, tagged);
    await attachTag(page, tagged, tag);

    await select(page, hidden);
    await filterSelect(page).selectOption({ label: tag });
    await expect(detail(page)).not.toContainText(hidden);
  });
});
