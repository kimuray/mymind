import { expect, test } from '@playwright/test';

// 画面間の同期（NFR-13、ADR-0008）。同じブラウザで2つのタブを開き、片方の変更がもう片方に反映されることを確かめる

test.describe('NFR-13 画面間の同期', () => {
  test('片方のタブで追加・状態を変えると、もう片方のタブに読み込み直しなしで反映される', async ({
    context,
  }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('/');
    await second.goto('/');

    const input = first.getByLabel('今日のタスクを追加');
    await input.fill('同期するタスク');
    await input.press('Enter');
    await expect(second.getByRole('button', { name: /^同期するタスク：未着手/ })).toBeVisible();

    await first.getByRole('button', { name: /^同期するタスク：未着手/ }).click();
    await expect(second.getByRole('button', { name: /^同期するタスク：着手中/ })).toBeVisible();
  });

  test('今日の画面で追加したタスクを明日へ移すと、開いているバックログや今日の画面から消える', async ({
    context,
  }) => {
    const today = await context.newPage();
    const other = await context.newPage();
    await today.goto('/');
    await other.goto('/');
    const input = today.getByLabel('今日のタスクを追加');
    await input.fill('明日へ移すタスク');
    await input.press('Enter');
    await expect(other.getByRole('button', { name: /^明日へ移すタスク：/ })).toBeVisible();

    await today
      .locator('.task-row', { hasText: '明日へ移すタスク' })
      .locator('.task-title')
      .click();
    await today.getByRole('button', { name: '明日へ', exact: true }).click();
    await expect(other.getByRole('button', { name: /^明日へ移すタスク：/ })).toHaveCount(0);
  });
});
