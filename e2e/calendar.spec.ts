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

/** 画面の中から設定を変える（状態を変える API にはトークンが要る） */
function patchSettings(page: Page, patch: Record<string, unknown>) {
  return page.evaluate(async (patch) => {
    const token =
      document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
      body: JSON.stringify(patch),
    });
    return res.status;
  }, patch);
}

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

  test('「依頼の前に毎回確認する」が有効なら送信内容を見せ、選んだエージェントで依頼する', async ({
    page,
  }) => {
    const day = `${ym}-09`;
    await page.goto('/');
    expect(await saveReflection(page, day, '確認してから依頼する振り返り')).toBe(200);
    expect(await patchSettings(page, { confirmBeforeRequest: true })).toBe(200);
    try {
      await page.goto(`/calendar/${ym}/${day}`);
      const detail = page.getByRole('complementary', { name: '詳細' });
      await detail.getByRole('combobox', { name: 'エージェント' }).selectOption('codex');
      await detail.getByRole('button', { name: 'FBをもらう' }).click();
      await expect(detail.getByRole('heading', { name: '送信内容' })).toBeVisible();
      await expect(detail).toContainText('確認してから依頼する振り返り');
      const requested = page
        .waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/jobs')
        .then((r) => r.postDataJSON() as { agent?: string; payloadHash?: string });
      await detail.getByRole('button', { name: 'この内容でFBをもらう' }).click();
      expect(await requested).toMatchObject({ agent: 'codex', payloadHash: expect.any(String) });
    } finally {
      await patchSettings(page, { confirmBeforeRequest: false });
    }
  });

  test('別のタブで振り返りを保存すると、開いているカレンダーに反映される', async ({ context }) => {
    const day = `${ym}-10`;
    const calendar = await context.newPage();
    const subscribed = calendar.waitForRequest((r) => r.url().endsWith('/api/events'));
    await calendar.goto(`/calendar/${ym}`);
    await subscribed;
    await expect(
      calendar.getByRole('link', { name: new RegExp(`月${dayNumber(day)}日（.） 記録なし`) }),
    ).toBeVisible();

    const reflection = await context.newPage();
    await reflection.goto(`/reflection/${day}`);
    await reflection.getByRole('textbox', { name: '思考の整理' }).click();
    await reflection.keyboard.type('別のタブで書いた振り返り');
    await reflection.keyboard.press('ControlOrMeta+s');
    await expect(reflection.locator('.reflection-notice')).toHaveText('保存しました');

    await expect(
      calendar.getByRole('link', { name: new RegExp(`月${dayNumber(day)}日（.） FBなし`) }),
    ).toBeVisible();
  });
});
