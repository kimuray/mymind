import { expect, type Page, test } from '@playwright/test';

// タスクのリストのキー操作（DESIGN.md 5章、FR-U01）。E2E のデータは実行の中で共有されるので、タスク名はテストごとに分ける

async function addTasks(page: Page, titles: string[]) {
  const input = page.getByLabel('今日のタスクを追加');
  for (const title of titles) {
    await input.fill(title);
    await input.press('Enter');
    await expect(page.getByRole('button', { name: new RegExp(`^${title}：`) })).toBeVisible();
  }
  // Esc で入力欄から抜けると、リストのキー操作に戻る
  await input.press('Escape');
}

const row = (page: Page, title: string) =>
  page.locator('.task-row', { has: page.getByRole('button', { name: new RegExp(`^${title}：`) }) });

test.describe('FR-U01 タスクのリストのキー操作', () => {
  test('J / K で選び、Space・P・X で状態を変え、T で明日へ移す', async ({ page }) => {
    await page.goto('/');
    await addTasks(page, ['キー操作A', 'キー操作B']);

    await page.keyboard.press('j');
    await expect(row(page, 'キー操作A')).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('j');
    await expect(row(page, 'キー操作B')).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('k');
    await expect(row(page, 'キー操作A')).toHaveAttribute('data-selected', 'true');

    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /^キー操作A：着手中/ })).toBeVisible();
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: /^キー操作A：中断/ })).toBeVisible();
    await page.keyboard.press('x');
    await expect(page.getByRole('button', { name: /^キー操作A：中止/ })).toBeVisible();

    await row(page, 'キー操作B').locator('.task-title').click();
    await page.keyboard.press('t');
    await expect(row(page, 'キー操作B')).toHaveCount(0);
  });

  test('入力欄にフォーカスがあるときは、単キーを文字として入力する', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('今日のタスクを追加');
    await input.click();
    await page.keyboard.type('jkptx');
    await expect(input).toHaveValue('jkptx');
  });

  test('N で追加の入力欄へ移り、E でタイトルを編集する', async ({ page }) => {
    await page.goto('/');
    await addTasks(page, ['編集前のタイトル']);
    await page.keyboard.press('n');
    await expect(page.getByLabel('今日のタスクを追加')).toBeFocused();
    await page.getByLabel('今日のタスクを追加').press('Escape');

    await row(page, '編集前のタイトル').locator('.task-title').click();
    await page.keyboard.press('e');
    const editor = page.getByLabel('タイトルを編集');
    await editor.fill('編集後のタイトル');
    await editor.press('Enter');
    await expect(page.getByRole('button', { name: /^編集後のタイトル：/ })).toBeVisible();
  });

  test('Tab で上のタスクの子にし、Shift+Tab で親に戻す', async ({ page }) => {
    await page.goto('/');
    await addTasks(page, ['親になるタスク', '子になるタスク']);
    await row(page, '子になるタスク').locator('.task-title').click();
    await page.keyboard.press('Tab');
    await expect(row(page, '子になるタスク')).toHaveAttribute('data-depth', '1');
    await page.keyboard.press('Shift+Tab');
    await expect(row(page, '子になるタスク')).toHaveAttribute('data-depth', '0');
  });

  test('⌘↓ で下のタスクと並べ替える', async ({ page }) => {
    await page.goto('/');
    await addTasks(page, ['並べ替え1', '並べ替え2']);
    const names = () => page.locator('[aria-label="今日やること"] .task-name').allTextContents();
    const before = await names();
    expect(before.indexOf('並べ替え1')).toBeLessThan(before.indexOf('並べ替え2'));
    await row(page, '並べ替え1').locator('.task-title').click();
    await page.keyboard.press('Meta+ArrowDown');
    await expect
      .poll(async () => {
        const after = await names();
        return after.indexOf('並べ替え1') > after.indexOf('並べ替え2');
      })
      .toBe(true);
  });

  test('G → B でバックログへ移る', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await expect(page).toHaveURL(/\/backlog$/);
    await expect(page.getByRole('heading', { level: 1, name: 'バックログ' })).toBeVisible();
  });
});
