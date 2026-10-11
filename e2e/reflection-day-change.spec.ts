import { expect, type Page, test } from '@playwright/test';

// 振り返りの画面を開いたまま業務日をまたいだとき（#272、NFR-14、FR-D06）。
// ブラウザの時刻だけを 5:00 の直前に固定する（e2e/day-change.spec.ts と同じ）

/** サーバーの今の業務日（Asia/Tokyo、5:00 切り替え） */
const serverDay = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - 5 * 60 * 60 * 1000),
  );

const monthDay = (day: string) => {
  const [, m, d] = day.split('-').map(Number);
  return `${m}月${d}日`;
};

const dayBefore = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) - 1)).toISOString().slice(0, 10);
};

const thoughts = (page: Page) => page.getByRole('textbox', { name: '思考の整理' });

test.describe('FR-D06 NFR-14 振り返りの画面を開いたまま業務日をまたぐ', () => {
  test('今日の画面へ移ると、前の日に書いた内容は残らず、今日の内容になる', async ({ page }) => {
    const today = serverDay();
    const yesterday = dayBefore(today);
    const text = `前の日の振り返り ${Date.now()}`;
    await page.clock.install({ time: new Date(`${today}T04:58:00+09:00`) });
    await page.goto('/reflection');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(yesterday));
    await thoughts(page).click();
    await page.keyboard.type(text);
    await page.getByRole('button', { name: '保存のみ' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();

    await page.clock.fastForward('03:00');
    // 入力欄で続けて打とうとすると（keydown）、業務日を確かめてダイアログを出す
    await page.keyboard.press('a');
    const dialog = page.getByRole('alertdialog', { name: '日付が変わりました' });
    await dialog.getByRole('button', { name: '今日の画面へ移る' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(today));
    await expect(thoughts(page)).toBeVisible();
    await expect(thoughts(page)).toHaveText('一行だけでも大丈夫です');
  });

  test('保存していない文字があっても、今日の画面へ移ると今日の欄は空になる', async ({ page }) => {
    const today = serverDay();
    const text = `保存していない振り返り ${Date.now()}`;
    await page.clock.install({ time: new Date(`${today}T04:58:00+09:00`) });
    await page.goto('/reflection');
    await thoughts(page).click();
    await page.keyboard.type(text);
    // 下書き（NFR-12）が書き込まれるのを待つ
    await page.clock.fastForward('00:05');

    await page.clock.fastForward('03:00');
    await page.keyboard.press('a');
    const dialog = page.getByRole('alertdialog', { name: '日付が変わりました' });
    await dialog.getByRole('button', { name: '今日の画面へ移る' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(today));
    await expect(thoughts(page)).toBeVisible();
    await expect(thoughts(page)).toHaveText('一行だけでも大丈夫です');
  });

  test('ほかの画面で日をまたいでから振り返りを開いても、今日の欄は前の日の内容にならない', async ({
    page,
  }) => {
    const today = serverDay();
    const text = `ほかの画面へ移る前の振り返り ${Date.now()}`;
    await page.clock.install({ time: new Date(`${today}T04:58:00+09:00`) });
    await page.goto('/reflection');
    await thoughts(page).click();
    await page.keyboard.type(text);
    await page.getByRole('button', { name: '保存のみ' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: /^今日/ }).click();
    await expect(page).toHaveURL(/\/$/);
    // 時刻を止めていると画面の切り替え（アニメーション）が進まないので、終わるまで少し進める
    await page.clock.runFor(1000);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(dayBefore(today)));

    await page.clock.fastForward('03:00');
    await page.keyboard.press('a');
    const dialog = page.getByRole('alertdialog', { name: '日付が変わりました' });
    await dialog.getByRole('button', { name: '今日の画面へ移る' }).click();
    await page
      .getByRole('navigation')
      .getByRole('link', { name: /^振り返り/ })
      .click();
    await page.clock.runFor(1000);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(today));
    await expect(thoughts(page)).toHaveText('一行だけでも大丈夫です');
  });
});

test.describe('FR-D06 過去の日の振り返りから今日の振り返りへ移る', () => {
  test('過去の日を開いたあとでナビから振り返りを開くと、今日の内容になる', async ({ page }) => {
    const today = serverDay();
    const yesterday = dayBefore(today);
    const text = `過去の日に書いた振り返り ${Date.now()}`;
    await page.goto(`/reflection/${yesterday}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(yesterday));
    await thoughts(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(text);
    await page.getByRole('button', { name: '保存のみ' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();

    await page
      .getByRole('navigation')
      .getByRole('link', { name: /^振り返り/ })
      .click();

    await expect(page).toHaveURL(/\/reflection$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(monthDay(today));
    await expect(thoughts(page)).not.toContainText(text);
  });
});
