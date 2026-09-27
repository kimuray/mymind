import { expect, type Page, test } from '@playwright/test';

// 振り返りの画面（FR-D06、FR-D08、偽のアダプタ）。すべてのテストが1つの DB を共有するので、
// 今日の振り返りを書くテストは、前のテストの内容を消してから書く

/** 入力欄（CodeMirror）の中身を入れ替える */
async function replaceText(page: Page, label: string, text: string) {
  const editor = page.getByRole('textbox', { name: label });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

/** 画面の中から設定を変える（状態を変える API にはトークンが要る） */
function setConfirmBeforeRequest(page: Page, value: boolean) {
  return page.evaluate(async (value) => {
    const token =
      document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
      body: JSON.stringify({ confirmBeforeRequest: value }),
    });
    return res.status;
  }, value);
}

const notice = (page: Page) => page.locator('.reflection-notice');

test.describe('FR-D06 FR-D08 振り返りを書いて保存する', () => {
  test('書いて「保存のみ」で保存すると、読み直しても内容が残っている', async ({ page }) => {
    await page.goto('/reflection');
    await replaceText(page, '思考の整理', '## 今日の手応え\n午後は設計に集中できた');
    await replaceText(page, '学び', '- 先に骨子を書く');
    await page.getByRole('button', { name: /^保存のみ/ }).click();
    await expect(notice(page)).toHaveText('保存しました');

    await page.reload();
    await expect(page.getByRole('textbox', { name: '思考の整理' })).toContainText(
      '午後は設計に集中できた',
    );
    await expect(page.getByRole('textbox', { name: '学び' })).toContainText('- 先に骨子を書く');
  });

  test('一行だけでも、入力欄の中から ⌘S で保存できる', async ({ page }) => {
    await page.goto('/reflection');
    await replaceText(page, '思考の整理', '疲れた');
    await replaceText(page, '学び', '');
    await page.keyboard.press('ControlOrMeta+s');
    await expect(notice(page)).toHaveText('保存しました');

    await page.reload();
    await expect(page.getByRole('textbox', { name: '思考の整理' })).toHaveText('疲れた');
  });

  test('日付を指定すると、過去の日の振り返りを書き足せる', async ({ page }) => {
    await page.goto('/reflection/2026-09-20');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('9月20日日曜日');
    await replaceText(page, '思考の整理', 'あとから書いた振り返り');
    await page.getByRole('button', { name: /^保存のみ/ }).click();
    await expect(notice(page)).toHaveText('保存しました');

    await page.reload();
    await expect(page.getByRole('textbox', { name: '思考の整理' })).toHaveText(
      'あとから書いた振り返り',
    );
    // 今日の振り返りには混ざらない
    await page.goto('/reflection');
    await expect(page.getByRole('textbox', { name: '思考の整理' })).not.toContainText(
      'あとから書いた振り返り',
    );
  });

  test('「保存してFBをもらう」で、保存してから FB を依頼する', async ({ page }) => {
    await page.goto('/reflection');
    await setConfirmBeforeRequest(page, false);
    await replaceText(page, '思考の整理', 'FB をもらう前の振り返り');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(notice(page)).toHaveText('保存して、FBを依頼しました');
    // ⌘↵ は入力欄の改行に使われない
    await expect(page.getByRole('textbox', { name: '思考の整理' })).toHaveText(
      'FB をもらう前の振り返り',
    );
  });

  test('「依頼の前に毎回確認する」が有効なら、保存してから送信内容を表示する', async ({ page }) => {
    await page.goto('/reflection');
    expect(await setConfirmBeforeRequest(page, true)).toBe(200);
    try {
      await page.reload();
      await replaceText(page, '思考の整理', '送信内容で確かめる振り返り');
      await page.getByRole('button', { name: /^保存してFBをもらう/ }).click();

      const detail = page.getByRole('complementary', { name: '詳細' });
      await expect(detail.getByRole('heading', { name: '送信内容' })).toBeVisible();
      await expect(detail).toContainText('送信内容で確かめる振り返り');
      await detail.getByRole('button', { name: 'この内容でFBをもらう' }).click();
      await expect(notice(page)).toHaveText('FBを依頼しました');
    } finally {
      await setConfirmBeforeRequest(page, false);
    }
  });
});

test.describe('FR-D06 NFR-02 書く／プレビューの切り替え', () => {
  test('プレビューで Markdown を表示し、⌘P でフォーカスのある欄だけを切り替える', async ({
    page,
  }) => {
    await page.goto('/reflection');
    await replaceText(page, '思考の整理', '## 手応え\n- **設計**に集中');
    await replaceText(page, '学び', '学んだこと');

    // 学びの欄にフォーカスがあるので、学びだけがプレビューになる
    await page.keyboard.press('ControlOrMeta+p');
    const learning = page.getByRole('region', { name: '学びのプレビュー' });
    await expect(learning).toHaveText('学んだこと');
    await expect(page.getByRole('region', { name: '思考の整理のプレビュー' })).toHaveCount(0);

    await page
      .getByRole('group', { name: '思考の整理の表示' })
      .getByRole('button', { name: 'プレビュー' })
      .click();
    const thoughts = page.getByRole('region', { name: '思考の整理のプレビュー' });
    await expect(thoughts.getByRole('heading', { name: '手応え' })).toBeVisible();
    await expect(thoughts.locator('strong')).toHaveText('設計');

    // 「書く」に戻すと、書いた内容のまま入力を続けられる
    await page
      .getByRole('group', { name: '思考の整理の表示' })
      .getByRole('button', { name: '書く' })
      .click();
    await expect(page.getByRole('textbox', { name: '思考の整理' })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('できた');
    await expect(page.getByRole('textbox', { name: '思考の整理' })).toContainText('に集中できた');
  });

  test('プレビューでは、振り返りに書いた HTML やスクリプトを実行しない', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto('/reflection');
    await replaceText(
      page,
      '思考の整理',
      '<img src=x onerror="alert(1)"><script>alert(2)</script>[押す](javascript:alert(3))',
    );
    await page
      .getByRole('group', { name: '思考の整理の表示' })
      .getByRole('button', { name: 'プレビュー' })
      .click();
    const preview = page.getByRole('region', { name: '思考の整理のプレビュー' });
    await expect(preview).toContainText('押す');
    await expect(preview.locator('img, script')).toHaveCount(0);
    await preview.getByText('押す').click();
    expect(dialogs).toEqual([]);
  });
});
