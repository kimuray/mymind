import { expect, type Page, test } from '@playwright/test';

// 設定画面の状態の表示（NFR-21、Figma「PC/設定」）

test.describe('NFR-21 設定画面の状態', () => {
  test('サイドバーから開くと、偽のエージェントが使えることが分かる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '設定' }).click();
    await expect(page.getByRole('heading', { name: '設定', level: 1 })).toBeVisible();
    const agentRow = page.getByRole('button', { name: /^エージェント/ });
    await expect(agentRow).toContainText('偽のアダプタ（開発用）');
    await expect(agentRow).toContainText('使えます');
  });

  test('エージェントが見つからない状態が、行と詳細ペインで分かる', async ({ page }) => {
    // 実物の CLI の有無に左右されないよう、サーバーの応答を差し替える
    await page.route('**/api/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'degraded',
          database: { ok: true, message: null, sizeBytes: 2516582 },
          agent: {
            name: 'claude',
            usable: false,
            executable: { found: false, version: null },
            message: 'claude が見つかりません（PATH を確認してください）',
          },
          backup: {
            file: 'pre-migration-20260925T075324Z.db',
            kind: 'pre-migration',
            at: '2026-09-25T07:53:24.000Z',
            result: 'succeeded',
            error: null,
          },
          recentFailure: {
            jobId: 'j1',
            kind: 'daily_feedback',
            period: '2026-09-24',
            error: '120秒以内に応答がなかったため中止しました',
            finishedAt: '2026-09-24T12:02:01.000Z',
          },
        }),
      }),
    );
    await page.goto('/settings');
    const agentRow = page.getByRole('button', { name: /^エージェント/ });
    await expect(agentRow).toContainText('Claude Code');
    await expect(agentRow).toContainText('使えません');
    await expect(agentRow).toContainText('claude が見つかりません（PATH を確認してください）');

    const detail = page.getByRole('complementary', { name: '詳細' });
    await expect(detail.getByText('使えない理由')).toBeVisible();
    await expect(detail.getByText('見つかりません', { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: /^最後のバックアップ/ })).toContainText(
      '9月25日 16:53',
    );
    await expect(page.getByRole('button', { name: /^DB のサイズ/ })).toContainText('2.4 MB');
    await page.getByRole('button', { name: /^直近の FB 生成の失敗/ }).click();
    await expect(detail).toContainText('9月24日の日次FB');
    await expect(detail).toContainText('120秒以内に応答がなかったため中止しました');
  });
});

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

const backupSettings = async (page: Page) => {
  const res = await page.request.get('/api/settings');
  return ((await res.json()) as { settings: Record<string, unknown> }).settings;
};

test.describe('NFR-04 毎日のバックアップの設定', () => {
  test('保存先と世代数を変えて保存でき、空にするとデータディレクトリの中に戻る', async ({
    page,
  }) => {
    await page.goto('/settings');
    const section = page.getByRole('region', { name: 'バックアップ' });
    const dir = section.getByRole('textbox', { name: /^保存先/ });
    const generations = section.getByRole('spinbutton', { name: /^残す世代数/ });
    await expect(generations).toHaveValue('14');
    try {
      await dir.fill('backups');
      await expect(section.getByRole('alert')).toContainText('/ から始まるパス');
      await dir.fill('/Volumes/外付け/mymind');
      await dir.press('Enter');
      await generations.fill('30');
      await expect
        .poll(() => backupSettings(page))
        .toMatchObject({ backupDir: '/Volumes/外付け/mymind', backupGenerations: 30 });

      await dir.fill('');
      await dir.blur();
      await expect.poll(() => backupSettings(page)).toMatchObject({ backupDir: null });
    } finally {
      await patchSettings(page, { backupDir: null, backupGenerations: 14 });
    }
  });

  test('NFR-23 毎日のバックアップに失敗したことが、状態の行で分かる', async ({ page }) => {
    await page.route('**/api/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          database: { ok: true, message: null, sizeBytes: 1024 },
          agent: { name: 'fake', usable: true, executable: null, message: null },
          backup: {
            file: null,
            kind: 'daily',
            at: '2026-10-04T18:30:00.000Z',
            result: 'failed',
            error: '整合性の検査に通りませんでした',
          },
          recentFailure: null,
        }),
      }),
    );
    await page.goto('/settings');
    const row = page.getByRole('button', { name: /^最後のバックアップ/ });
    await expect(row).toContainText('10月5日 03:30');
    await expect(row).toContainText(
      '毎日のバックアップに失敗しました（整合性の検査に通りませんでした）',
    );
    await expect(row).toContainText('失敗');
  });
});
