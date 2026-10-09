import { expect, type Page, test } from '@playwright/test';

// タスクのメモ（FR-T09、NFR-12）。詳細ペインの Markdown の欄で書き、欄から抜けたときに保存する

const uniqueTitle = (base: string) => `${base}-${Date.now().toString(36)}`;

async function addAndSelect(page: Page, title: string) {
  await page.getByLabel('今日のタスクを追加').fill(title);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByRole('complementary', { name: '詳細' })).toContainText(title);
}

const memoEditor = (page: Page) =>
  page
    .getByRole('complementary', { name: '詳細' })
    .getByRole('textbox', { name: 'メモ', exact: true });

async function writeMemo(page: Page, text: string) {
  await memoEditor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

/** 欄から抜ける（詳細ペインの見出しを押す） */
const leaveMemo = (page: Page) =>
  page
    .getByRole('complementary', { name: '詳細' })
    .getByRole('heading', { level: 2 })
    .first()
    .click();

test.describe('FR-T09 タスクのメモ', () => {
  test('詳細ペインでメモを書き、欄から抜けると保存され、行にメモの印が出る', async ({ page }) => {
    const title = uniqueTitle('メモを書く');
    await page.goto('/');
    await addAndSelect(page, title);
    await writeMemo(page, '## 調べること\n- 価格');
    await leaveMemo(page);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByText('保存しました')).toBeVisible();
    await expect(
      page.locator('.task-row', { hasText: title }).locator('.task-note-mark'),
    ).toHaveText('メモ');

    // 読み直しても残っている
    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(memoEditor(page)).toContainText('## 調べること');
  });

  test('⌘P でプレビューに切り替えると、Markdown を表示する', async ({ page }) => {
    const title = uniqueTitle('メモのプレビュー');
    await page.goto('/');
    await addAndSelect(page, title);
    await writeMemo(page, '**大事**なこと');
    await page.keyboard.press('ControlOrMeta+p');
    const preview = page.getByRole('region', { name: 'メモのプレビュー' });
    await expect(preview.locator('strong')).toHaveText('大事');
  });

  test('別のタスクを選ぶと、書きかけのメモを保存する', async ({ page }) => {
    const first = uniqueTitle('メモの1つ目');
    const second = uniqueTitle('メモの2つ目');
    await page.goto('/');
    await addAndSelect(page, first);
    await addAndSelect(page, second);
    await page.getByRole('button', { name: first, exact: true }).click();
    await writeMemo(page, '選び直す前に書いた');
    await page.getByRole('button', { name: second, exact: true }).click();
    await expect(
      page.locator('.task-row', { hasText: first }).locator('.task-note-mark'),
    ).toBeVisible();
    await page.getByRole('button', { name: first, exact: true }).click();
    await expect(memoEditor(page)).toContainText('選び直す前に書いた');
  });

  test('NFR-12 保存できなかった書きかけは下書きに残り、次に開いたときに復元できる', async ({
    page,
  }) => {
    const title = uniqueTitle('メモの下書き');
    await page.goto('/');
    await addAndSelect(page, title);
    // サーバーに届かない状態で書く
    await page.route('**/api/tasks/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue(),
    );
    await writeMemo(page, '届かなかったメモ');
    // 下書きを書き込むまで待つ（入力が止まってから1秒後）
    await page.waitForTimeout(1500);
    await leaveMemo(page);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByText(/保存できませんでした/)).toBeVisible();
    await page.unroute('**/api/tasks/*');

    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(detail.getByText(/保存していないメモの下書きがあります/)).toBeVisible();
    await detail.getByRole('button', { name: '復元する' }).click();
    await expect(memoEditor(page)).toContainText('届かなかったメモ');
    await leaveMemo(page);
    await expect(detail.getByText('保存しました')).toBeVisible();
  });

  test('NFR-12 書いてすぐ別のタスクを選び、保存も届かなくても、書きかけは下書きに残る', async ({
    page,
  }) => {
    const first = uniqueTitle('メモをすぐ離れる');
    const second = uniqueTitle('メモの移り先');
    await page.goto('/');
    await addAndSelect(page, first);
    await addAndSelect(page, second);
    await page.getByRole('button', { name: first, exact: true }).click();
    await page.route('**/api/tasks/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue(),
    );
    // 1秒を待たずに別のタスクを選ぶ
    await writeMemo(page, 'すぐ離れたメモ');
    await page.getByRole('button', { name: second, exact: true }).click();
    await page.waitForTimeout(500);
    await page.unroute('**/api/tasks/*');

    await page.reload();
    await page.getByRole('button', { name: first, exact: true }).click();
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByText(/保存していないメモの下書きがあります/)).toBeVisible();
  });

  test('NFR-13 保存が遅れている間に書き直しても、最後の内容が保存される', async ({ page }) => {
    const title = uniqueTitle('メモを続けて保存');
    await page.goto('/');
    await addAndSelect(page, title);
    // 1件目の保存だけを遅らせる
    let delayed = false;
    await page.route('**/api/tasks/*', async (route) => {
      if (route.request().method() === 'PATCH' && !delayed) {
        delayed = true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      await route.continue();
    });
    await writeMemo(page, '1回目');
    await leaveMemo(page);
    await writeMemo(page, '2回目');
    await leaveMemo(page);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByText('保存しました')).toBeVisible({ timeout: 10_000 });
    await expect(detail.getByText(/保存できませんでした/)).toHaveCount(0);
    await page.unroute('**/api/tasks/*');
    await page.reload();
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(memoEditor(page)).toHaveText('2回目');
  });
});
