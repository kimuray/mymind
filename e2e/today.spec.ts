import { expect, test } from '@playwright/test';

// M1 で実装する主要フロー。実装が入った時点で fixme を外す。
test.describe('FR-T01 / FR-T03 今日のタスク', () => {
  test.fixme('タスクを追加して、Space で未着手→着手中→完了に進められる', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('今日のタスクを追加').fill('企画書ドラフトを書く');
    await page.keyboard.press('Enter');
    const row = page.getByRole('button', { name: /企画書ドラフトを書く：未着手/ });
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /企画書ドラフトを書く：着手中/ })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /企画書ドラフトを書く：完了/ })).toBeVisible();
  });
});

test.describe('FR-A01 / FR-A08 FB の依頼', () => {
  test.fixme('保存してFBをもらうと、生成中の表示を経てFBと調子が表示される', async ({ page }) => {
    await page.goto('/reflection');
    await page.getByLabel('思考の整理').fill('## 今日の手応え\n午後は設計に集中できた。');
    await page.getByRole('button', { name: '保存してFBをもらう' }).click();
    await expect(page.getByText('マメが考えています')).toBeVisible();
    await expect(page.getByRole('heading', { name: '明日の一手' })).toBeVisible();
  });
});
