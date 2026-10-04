import { expect, test } from '@playwright/test';

// コマンドパレット（FR-U02）とショートカットの一覧（FR-U03）。どちらもキーマップの定義から作る

test.describe('FR-U02 コマンドパレット', () => {
  test('⌘K で開き、検索して Enter で画面を移動する', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click();
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'コマンドパレット' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox', { name: '操作を検索' })).toBeFocused();

    // 画面の移動は定義の先頭にあるので、絞り込んだ候補の先頭に来て選ばれている
    await page.keyboard.type('バックログ');
    await expect(palette.getByRole('option', { selected: true })).toHaveText(/^バックログG → B$/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/backlog$/);
    await expect(palette).toHaveCount(0);
  });

  test('↑↓ で候補を選び、Esc で何もせずに閉じる', async ({ page }) => {
    await page.goto('/backlog');
    await page.locator('body').click();
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'コマンドパレット' });
    const selected = palette.getByRole('option', { selected: true });
    const first = await selected.textContent();
    await page.keyboard.press('ArrowDown');
    await expect(selected).not.toHaveText(first ?? '');
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(page).toHaveURL(/\/backlog$/);
  });

  test('パレットには、今の画面で使える操作だけを出す', async ({ page }) => {
    await page.goto('/reflection');
    await page.locator('body').click();
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'コマンドパレット' });
    await expect(palette.getByRole('option', { name: /保存のみ/ })).toBeVisible();
    // 朝の計画やバックログの判断のキーは、振り返りの画面では使えない
    await expect(palette.getByRole('option', { name: /1つ目の判断/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});

test.describe('FR-U03 ショートカットの一覧', () => {
  test('? で今の画面のキーの一覧を開き、Esc で閉じる', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click();
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'ショートカットの一覧' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('コマンドパレット');
    await expect(help).toContainText('⌘K');
    await expect(help).toContainText('次のタスク');
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
  });

  test('入力欄の中で ? を押しても一覧を開かず、文字として入力する', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('今日のタスクを追加');
    await input.click();
    await page.keyboard.type('なぜ?');
    await expect(input).toHaveValue('なぜ?');
    await expect(page.getByRole('dialog', { name: 'ショートカットの一覧' })).toHaveCount(0);
  });
});
