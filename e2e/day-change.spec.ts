import { expect, type Page, test } from '@playwright/test';

// 業務日の切り替え検知（NFR-14）。ブラウザの時刻だけを 5:00 の直前に固定し、切り替えをまたいで操作する。
// サーバーは実際の時刻で動くので、5:00 を過ぎたあとの業務日がサーバーの業務日と一致するように時刻を選ぶ

/** サーバーの今の業務日（Asia/Tokyo、5:00 切り替え） */
const serverDay = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - 5 * 60 * 60 * 1000),
  );

const monthDay = (day: string) => {
  const [, m, d] = day.split('-').map(Number);
  return `${m}月${d}日`;
};

/** 前の業務日の 4:58 に開き、5:01 まで進める */
async function openBeforeDayChange(page: Page) {
  const today = serverDay();
  await page.clock.install({ time: new Date(`${today}T04:58:00+09:00`) });
  await page.goto('/');
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) - 1))
    .toISOString()
    .slice(0, 10);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(yesterday));
  await page.clock.fastForward('03:00');
  return { today, yesterday };
}

test.describe('NFR-14 業務日の切り替え検知', () => {
  test('5:00 をまたいで操作すると、操作を止めてダイアログを出し、今日の画面へ移れる', async ({
    page,
  }) => {
    const { today } = await openBeforeDayChange(page);
    // 入力欄にフォーカスを移そうとすると（focusin）、業務日を確かめてダイアログを出す
    await page.getByLabel('今日のタスクを追加').focus();
    const dialog = page.getByRole('alertdialog', { name: '日付が変わりました' });
    await expect(dialog).toBeVisible();
    // 既定の操作にフォーカスがある
    await expect(dialog.getByRole('button', { name: '今日の画面へ移る' })).toBeFocused();

    await dialog.getByRole('button', { name: '今日の画面へ移る' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(today));

    const input = page.getByLabel('今日のタスクを追加');
    await input.fill('切り替え後のタスク');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: /^切り替え後のタスク：/ })).toBeVisible();
  });

  test('「前の日の記録として続ける」を選ぶと、前の日の画面のまま更新できる', async ({ page }) => {
    const { yesterday } = await openBeforeDayChange(page);
    // 入力欄にフォーカスを移そうとすると（focusin）、業務日を確かめてダイアログを出す
    await page.getByLabel('今日のタスクを追加').focus();
    const dialog = page.getByRole('alertdialog', { name: '日付が変わりました' });
    await dialog.getByRole('button', { name: /前の日（.+）の記録として続ける/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(yesterday));

    const input = page.getByLabel('今日のタスクを追加');
    await input.fill('前の日に書き足すタスク');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: /^前の日に書き足すタスク：/ })).toBeVisible();
  });
});
