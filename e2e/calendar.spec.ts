import { expect, type Page, test } from '@playwright/test';

// カレンダー（FR-R04、FR-A05、FR-A09、偽のアダプタ）。すべてのテストが1つの DB を共有し、
// ほかのテストは今月と先月の日に書き込むので、ここでは2か月前の月を使う

/** 今の業務日（Asia/Tokyo、5時で切り替え。サーバーの初期値と同じ）の月から n か月前 */
const monthBefore = (n: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - 5 * 60 * 60 * 1000),
  );
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 - n, 1)).toISOString().slice(0, 7);
};

/** 画面の中から振り返りを保存する（状態を変える API にはトークンが要る） */
function saveReflection(page: Page, day: string, thoughtsMd: string) {
  return page.evaluate(
    async ({ day, thoughtsMd }) => {
      const token =
        document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
      const res = await fetch(`/api/days/${day}/log`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
        body: JSON.stringify({ thoughtsMd, learningMd: '' }),
      });
      return res.status;
    },
    { day, thoughtsMd },
  );
}

const ym = monthBefore(2);
const dayNumber = (day: string) => Number(day.slice(8));

test.describe('FR-R04 FR-A05 FR-A09 カレンダー', () => {
  test('振り返りはあるが FB のない日を選ぶと記録が出て、後から FB を依頼できる', async ({
    page,
  }) => {
    const day = `${ym}-07`;
    await page.goto('/');
    expect(await saveReflection(page, day, 'カレンダーから見返す振り返り')).toBe(200);

    await page.goto(`/calendar/${ym}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`,
    );
    const cell = page.getByRole('link', { name: new RegExp(`月${dayNumber(day)}日（.） FBなし`) });
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${ym}/${day}$`));

    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail).toContainText('カレンダーから見返す振り返り');
    await expect(detail).toContainText('まだFBをもらっていません');
    await detail.getByRole('button', { name: 'FBをもらう' }).click();
    await expect(detail.getByRole('heading', { name: 'よかったこと' })).toBeVisible({
      timeout: 15_000,
    });
    // FB をもらうと、その日のマスのマメが調子の表情になる
    await expect(
      page.getByRole('link', { name: new RegExp(`月${dayNumber(day)}日（.） 調子：`) }),
    ).toBeVisible();
  });

  test('計画も振り返りもない日は「記録なし」と表示し、FB を依頼するボタンを出さない', async ({
    page,
  }) => {
    const day = `${ym}-08`;
    await page.goto(`/calendar/${ym}/${day}`);
    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail).toContainText('記録なし');
    await expect(detail.getByRole('button', { name: 'FBをもらう' })).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: new RegExp(`月${dayNumber(day)}日（.） 記録なし`) }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('前後の月へ移れる', async ({ page }) => {
    await page.goto(`/calendar/${ym}`);
    await page.getByRole('link', { name: '次の月' }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${monthBefore(1)}$`));
    await page.getByRole('link', { name: '前の月' }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${ym}$`));
  });
});
