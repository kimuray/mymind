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

test.describe('NFR-12 下書きの保護', () => {
  // 他のテストの下書きと混ざらないよう、過去の日を使う
  const path = '/reflection/2026-09-10';

  test('保存前にタブを閉じても、再度開くと復元を提示され、復元すると書きかけに戻る', async ({
    context,
  }) => {
    const first = await context.newPage();
    await first.goto(path);
    await replaceText(first, '思考の整理', '保存する前に閉じた書きかけ');
    // 入力が止まってから1秒後に下書きを書く
    await first.waitForTimeout(1500);
    await first.close();

    const second = await context.newPage();
    await second.goto(path);
    const offer = second.getByRole('status').filter({ hasText: '保存していない下書きがあります' });
    await expect(offer).toBeVisible();
    await expect(second.getByRole('textbox', { name: '思考の整理' })).not.toContainText('書きかけ');
    await offer.getByRole('button', { name: '復元する' }).click();
    await expect(second.getByRole('textbox', { name: '思考の整理' })).toHaveText(
      '保存する前に閉じた書きかけ',
    );

    // 保存すると下書きは消え、開き直しても尋ねない
    await second.getByRole('button', { name: /^保存のみ/ }).click();
    await expect(notice(second)).toHaveText('保存しました');
    await second.reload();
    await expect(second.getByRole('textbox', { name: '思考の整理' })).toHaveText(
      '保存する前に閉じた書きかけ',
    );
    await second.waitForTimeout(500);
    await expect(second.getByText('保存していない下書きがあります')).toHaveCount(0);
  });

  test('「破棄する」を選ぶと、下書きを消して保存した内容のまま続ける', async ({ page }) => {
    await page.goto(path);
    const before = await page.getByRole('textbox', { name: '学び' }).textContent();
    await replaceText(page, '学び', '捨てる下書き');
    await page.waitForTimeout(1500);
    await page.reload();

    await page.getByRole('button', { name: '破棄する' }).click();
    await expect(page.getByText('保存していない下書きがあります')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '学び' })).not.toContainText('捨てる下書き');
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.getByText('保存していない下書きがあります')).toHaveCount(0);
    expect(before).not.toContain('捨てる下書き');
  });
});

test.describe('FR-D07 振り返りの冒頭の記録のまとめ', () => {
  test('今日の画面でタスクを完了にすると、振り返りの冒頭の完了に出る', async ({ page }) => {
    // 再試行や繰り返しの実行で前のタスクと重ならないよう、名前を毎回変える
    const title = `まとめに出るタスク-${Date.now().toString(36)}`;
    await page.goto('/');
    const input = page.getByLabel('今日のタスクを追加');
    await input.fill(title);
    await input.press('Enter');
    const status = (label: string) =>
      page.getByRole('button', { name: new RegExp(`^${title}：${label}`) });
    await expect(status('未着手')).toBeVisible();
    // 状態のアイコンにフォーカスだけを当てる（押すとそれだけで状態が進み、着手中を見逃す。FR-T01 の E2E と同じ）
    await status('未着手').focus();
    // 未着手 → 着手中 → 完了
    await page.keyboard.press(' ');
    await expect(status('着手中')).toBeVisible();
    await page.keyboard.press(' ');
    await expect(status('完了')).toBeVisible();

    await page.goto('/reflection');
    const summary = page.getByRole('region', { name: 'この日の記録' });
    await expect(summary).toContainText(title);
    await expect(summary.getByRole('heading', { name: /^完了/ })).toBeVisible();
  });
});

test.describe('FR-A01 FR-A03 FR-A04 FR-A08 振り返りの FB', () => {
  const panel = (page: Page) => page.getByRole('region', { name: 'この日のフィードバック' });

  test('FB をもらうと生成中を経て表示され、もう一度もらうとまた生成中を経て表示される', async ({
    page,
  }) => {
    await page.goto('/reflection/2026-09-13');
    await replaceText(page, '思考の整理', 'FB をもらう日の振り返り');
    await panel(page).getByRole('button', { name: 'FBをもらう' }).click();
    await expect(panel(page).getByText('マメが考えています')).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: '明日の一手' })).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'よかったこと' })).toBeVisible();

    await panel(page).getByRole('button', { name: 'もう一度もらう' }).click();
    await expect(panel(page).getByText('マメが考えています')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'もう一度もらう' })).toBeVisible();
  });

  test('生成中にキャンセルすると、FB をもらっていない状態に戻る', async ({ page }) => {
    await page.goto('/reflection/2026-09-14');
    await replaceText(page, '思考の整理', 'キャンセルする日の振り返り');
    await panel(page).getByRole('button', { name: 'FBをもらう' }).click();
    await panel(page).getByRole('button', { name: 'キャンセル' }).click();
    await expect(panel(page).getByText('まだFBをもらっていません')).toBeVisible();
  });

  test('調子を手で直すと、読み直しても残り、もう一度押すと AI の判定に戻る', async ({ page }) => {
    await page.goto('/reflection/2026-09-13');
    await expect(panel(page).getByRole('heading', { name: '明日の一手' })).toBeVisible();
    const picker = panel(page).getByRole('group', { name: '調子を直す' });
    await picker.getByRole('button', { name: '絶不調' }).click();
    await expect(panel(page).getByText(/手動で修正（AIの判定：/)).toBeVisible();
    await page.reload();
    await expect(picker.getByRole('button', { name: '絶不調' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await picker.getByRole('button', { name: '絶不調' }).click();
    await expect(panel(page).getByText(/手動で修正/)).toHaveCount(0);
  });
});

test.describe('FR-A08 FB の順番待ちと失敗の表示（#23）', () => {
  const panel = (page: Page) => page.getByRole('region', { name: 'この日のフィードバック' });

  /** 画面の中から FB を依頼する（状態を変える API にはトークンが要る） */
  const requestFeedback = (page: Page, period: string) =>
    page.evaluate(async (period) => {
      const token =
        document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
        body: JSON.stringify({ kind: 'daily_feedback', period }),
      });
      return res.status;
    }, period);

  test('前の依頼が生成中のあいだ、あとの依頼は順番待ちと表示し、順番が来ると FB が出る', async ({
    page,
  }) => {
    await page.goto('/reflection/2026-09-16');
    expect(await requestFeedback(page, '2026-09-15')).toBe(202);
    expect(await requestFeedback(page, '2026-09-16')).toBe(202);
    await page.reload();
    await expect(panel(page).getByText('前の依頼が終わるのを待っています')).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: '明日の一手' })).toBeVisible({
      timeout: 10_000,
    });
  });

  for (const [kind, message] of [
    [
      '未ログイン',
      'エージェントにログインしていないようです。ターミナルでログインしてから、もう一度依頼してください（claude、終了コード 1：Please run /login）',
    ],
    [
      '利用上限',
      'エージェントの利用上限に達したようです。しばらく待ってから、もう一度依頼してください（claude：usage limit）',
    ],
    [
      '時間切れ',
      '時間内に応答がありませんでした。もう一度依頼するか、MYMIND_AGENT_TIMEOUT_SEC を長くしてください（120秒で中止しました）',
    ],
    [
      '形式違反',
      'エージェントの返答が FB の形になっていませんでした。もう一度依頼してください（JSON が見つかりません）',
    ],
  ] as const) {
    test(`${kind}で失敗したら、理由と対処を出し、再試行できる`, async ({ page }) => {
      // サーバーの応答を差し替え、その日の最新のジョブを失敗にする（偽のアダプタでは起こせない失敗を見せるため）
      await page.route('**/api/days/2026-09-17', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({
          response: res,
          json: {
            ...body,
            feedback: null,
            job: {
              id: 'j-failed',
              kind: 'daily_feedback',
              period: '2026-09-17',
              agent: 'claude',
              status: 'failed',
              error: message,
              createdAt: '2026-09-17T12:00:00.000Z',
              startedAt: '2026-09-17T12:00:01.000Z',
              finishedAt: '2026-09-17T12:02:01.000Z',
            },
          },
        });
      });
      await page.goto('/reflection/2026-09-17');
      await expect(panel(page)).toContainText(`FBをもらえませんでした：${message}`);
      await expect(panel(page).getByRole('button', { name: '再試行' })).toBeVisible();
    });
  }
});

test.describe('FR-A07 使うエージェントの選択', () => {
  /** 画面の中から既定のエージェントを戻す（すべてのテストが1つの DB を共有するため） */
  const resetDefaultAgent = (page: Page) =>
    page.evaluate(async () => {
      const token =
        document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
        body: JSON.stringify({ defaultAgent: 'claude' }),
      });
    });

  /** 次の FB の依頼で送るエージェントを捕まえる */
  const nextRequestedAgent = (page: Page) =>
    page
      .waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/jobs')
      .then((r) => (r.postDataJSON() as { agent?: string }).agent);

  test('設定で選んだ既定のエージェントが振り返りで選ばれ、依頼ごとに切り替えられる', async ({
    page,
  }) => {
    await page.goto('/settings');
    try {
      await page.getByRole('combobox', { name: '既定のエージェント' }).selectOption('codex');
      await expect(page.getByRole('combobox', { name: '既定のエージェント' })).toHaveValue('codex');

      await page.goto('/reflection/2026-09-11');
      const select = page.getByRole('combobox', { name: 'エージェント' });
      await expect(select).toHaveValue('codex');
      const first = nextRequestedAgent(page);
      await page.getByRole('button', { name: /^保存してFBをもらう/ }).click();
      expect(await first).toBe('codex');

      await page.goto('/reflection/2026-09-12');
      await page.getByRole('combobox', { name: 'エージェント' }).selectOption('claude');
      const second = nextRequestedAgent(page);
      await page.getByRole('button', { name: /^保存してFBをもらう/ }).click();
      expect(await second).toBe('claude');
    } finally {
      await resetDefaultAgent(page);
    }
  });
});
