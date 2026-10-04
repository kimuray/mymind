import { expect, type Page, test } from '@playwright/test';

// E2E はサーバー（DB）を共有し、再試行でも前の回のタスクが残るので、回ごとに名前を変える
const uniqueTitle = (base: string) => `${base}-${Date.now().toString(36)}`;

/**
 * 受け取る側のタブが知らせを購読し終えるまで待つ。
 * 読み込みが終わっても購読（AppShell の useEffect）はまだのことがあり、その間に送った知らせは届かない。
 * 購読は GET /api/events を開くのと同じ処理の中で始めるので、そのリクエストが出たら購読済みとみなせる
 */
async function openSubscribed(page: Page) {
  const subscribed = page.waitForRequest((r) => r.url().endsWith('/api/events'));
  await page.goto('/');
  await subscribed;
}

// 画面間の同期（NFR-13、ADR-0008）。同じブラウザで2つのタブを開き、片方の変更がもう片方に反映されることを確かめる

test.describe('NFR-13 画面間の同期', () => {
  test('片方のタブで追加・状態を変えると、もう片方のタブに読み込み直しなしで反映される', async ({
    context,
  }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('/');
    await openSubscribed(second);

    const input = first.getByLabel('今日のタスクを追加');
    const title = uniqueTitle('同期するタスク');
    await input.fill(title);
    await input.press('Enter');
    await expect(
      second.getByRole('button', { name: `${title}：未着手`, exact: false }),
    ).toBeVisible();

    await first.getByRole('button', { name: `${title}：未着手`, exact: false }).click();
    await expect(
      second.getByRole('button', { name: `${title}：着手中`, exact: false }),
    ).toBeVisible();
  });

  test('今日の画面で追加したタスクを明日へ移すと、開いているバックログや今日の画面から消える', async ({
    context,
  }) => {
    const today = await context.newPage();
    const other = await context.newPage();
    await today.goto('/');
    await openSubscribed(other);
    const input = today.getByLabel('今日のタスクを追加');
    const title = uniqueTitle('明日へ移すタスク');
    await input.fill(title);
    await input.press('Enter');
    await expect(other.getByRole('button', { name: `${title}：`, exact: false })).toBeVisible();

    await today.locator('.task-row', { hasText: title }).locator('.task-title').click();
    await today.getByRole('button', { name: '明日へ', exact: true }).click();
    await expect(other.getByRole('button', { name: `${title}：`, exact: false })).toHaveCount(0);
  });
});

test.describe('NFR-13 FR-A07 設定の同期', () => {
  test('片方のタブで既定のエージェントを変えると、もう片方の振り返りの選択に反映される', async ({
    context,
  }) => {
    const settings = await context.newPage();
    const reflection = await context.newPage();
    await settings.goto('/settings');
    const subscribed = reflection.waitForRequest((r) => r.url().endsWith('/api/events'));
    await reflection.goto('/reflection/2026-09-10');
    await subscribed;
    const select = reflection.getByRole('combobox', { name: 'エージェント' });
    await expect(select).toHaveValue('claude');

    const defaultAgent = settings.getByRole('combobox', { name: '既定のエージェント' });
    try {
      await defaultAgent.selectOption('codex');
      await expect(select).toHaveValue('codex');
    } finally {
      // すべてのテストが1つの DB を共有するので、既定に戻す
      await defaultAgent.selectOption('claude');
      await expect(select).toHaveValue('claude');
    }
  });
});
