import AxeBuilder from '@axe-core/playwright';
import { type CDPSession, expect, type Page, test } from '@playwright/test';

// コントラスト・動きの設定への対応（NFR-22）とコントラストの検査（NFR-06）

/** OS の「視差効果を減らす」と、必要なら「コントラストを上げる」を Chromium でエミュレートする */
async function emulatePreferences(
  page: Page,
  { moreContrast = false }: { moreContrast?: boolean } = {},
): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      ...(moreContrast ? [{ name: 'prefers-contrast', value: 'more' }] : []),
    ],
  });
  return cdp;
}

/** 地と面の色（DESIGN.md 2.3 の --ground と --surface） */
const groundColor = 'rgb(228, 233, 240)';

// サンドボックスの中ではページを使い回す（playwright.config.ts の reuseContext）ので、
// Playwright が把握していない CDP のエミュレーションを次のテストに残さない。
// エミュレーションはセッションごとに効くので、設定したセッションで戻す
let emulation: CDPSession | undefined;
test.afterEach(async () => {
  await emulation?.send('Emulation.setEmulatedMedia', { features: [] });
  await emulation?.detach();
  emulation = undefined;
});

async function addTask(page: Page, title: string) {
  const input = page.getByLabel('今日のタスクを追加');
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('button', { name: new RegExp(`^${title}：`) })).toBeVisible();
}

/** 今の業務日（Asia/Tokyo、5時で切り替え）の月 */
const currentMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })
    .format(new Date(Date.now() - 5 * 60 * 60 * 1000))
    .slice(0, 7);

test.describe('NFR-22 コントラスト・動きの設定への対応', () => {
  test('面は地と同じ色で塗り、背景のにじみも backdrop-filter も使わない', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.getByRole('navigation', { name: '画面' });
    await expect(sidebar).toHaveCSS('backdrop-filter', 'none');
    await expect(sidebar).toHaveCSS('background-color', groundColor);
    await expect(page.locator('body')).toHaveCSS('background-color', groundColor);
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  });

  test('カレンダーの表は、地と同じ色のくぼんだ面にする', async ({ page }) => {
    await page.goto(`/calendar/${currentMonth()}`);
    const grid = page.locator('.calendar-grid');
    await expect(grid).toHaveCSS('backdrop-filter', 'none');
    await expect(grid).toHaveCSS('background-color', groundColor);
    await expect(grid).toHaveCSS('box-shadow', /inset/);
  });

  test('振り返りの画面も、ほかの画面と同じ地にする', async ({ page }) => {
    await page.goto('/reflection');
    await expect(page.locator('body')).toHaveCSS('background-color', groundColor);
  });

  test('コントラストを上げる設定では、浮き出た面の縁を濃い線にする', async ({ page }) => {
    const sidebar = page.getByRole('navigation', { name: '画面' });
    await page.goto('/');
    await expect(sidebar).toHaveCSS('border-top-color', 'rgba(255, 255, 255, 0.5)');
    emulation = await emulatePreferences(page, { moreContrast: true });
    await expect(sidebar).toHaveCSS('border-top-color', 'rgba(26, 31, 41, 0.24)');
  });

  test('視差効果を減らす設定では、マメの考え中の泡を動かさない', async ({ page }) => {
    emulation = await emulatePreferences(page);
    await page.goto('/dev/mame');
    await expect(page.locator('.mame-bubbles').first()).toHaveCSS('animation-name', 'none');
  });

  test('設定がなければ、マメの泡の動きはそのまま', async ({ page }) => {
    // E2E は既定で「視差効果を減らす」で動かす（playwright.config.ts）ので、このテストだけ戻す
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      await page.goto('/dev/mame');
      await expect(page.locator('.mame-bubbles').first()).toHaveCSS('animation-name', 'mame-think');
      // 動きの時間と緩急は、DESIGN.md 2.7 のトークンを使う
      await expect(page.locator('.mame-bubbles').first()).toHaveCSS('animation-duration', '1.6s');
    } finally {
      // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
  });

  test('E2E は「視差効果を減らす」で動かし、動きを止めた状態で確かめる', async ({ page }) => {
    await page.goto('/dev/mame');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );
    await expect(page.locator('.mame-bubbles').first()).toHaveCSS('animation-name', 'none');
  });
});

/** WCAG 2 AA のコントラストの違反がないことを axe で確かめる */
async function expectNoContrastViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .withRules(['color-contrast'])
    .analyze();
  // 検査が空振りしていない（背景色を決められずに判定を見送っただけではない）ことを確かめる
  expect(results.passes.flatMap((v) => v.nodes).length).toBeGreaterThan(0);
  expect(
    results.violations.flatMap((v) =>
      v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary}`),
    ),
  ).toEqual([]);
}

const screens = [
  ['今日', '/'],
  ['バックログ', '/backlog'],
  ['朝の計画', '/morning'],
  ['振り返り', '/reflection'],
  ['マメの表情', '/dev/mame'],
  ['設定', '/settings'],
  ['カレンダー', `/calendar/${currentMonth()}`],
  ['タイムライン', '/timeline'],
] as const;

test.describe('NFR-06 コントラスト', () => {
  for (const [name, path] of screens) {
    test(`${name}の画面に、WCAG 2 AA のコントラストの違反がない`, async ({ page }) => {
      // 面は地と同じ不透明な色なので、ふだんの画面のまま検査できる（ADR-0018）
      emulation = await emulatePreferences(page);
      await page.goto('/');
      await addTask(page, `コントラスト確認（${name}）`);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoContrastViolations(page);
    });
  }

  for (const [name, path] of screens) {
    test(`「コントラストを上げる」設定でも、${name}の画面に違反がない`, async ({ page }) => {
      // 縁を濃い線にし、影を弱めた画面（ADR-0018、DESIGN.md 2.3）
      emulation = await emulatePreferences(page, { moreContrast: true });
      await page.goto('/');
      await addTask(page, `コントラスト確認（${name}・高コントラスト）`);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoContrastViolations(page);
    });
  }

  for (const moreContrast of [false, true]) {
    const setting = moreContrast ? '「コントラストを上げる」設定で、' : '';
    test(`${setting}タスクを選んで詳細ペインを開いた画面に、違反がない`, async ({ page }) => {
      emulation = await emulatePreferences(page, { moreContrast });
      const title = `コントラスト確認（詳細）-${Date.now().toString(36)}`;
      await page.goto('/');
      await addTask(page, title);
      await page.getByRole('button', { name: title, exact: true }).click();
      await expect(page.getByRole('complementary', { name: '詳細' })).toContainText(title);
      await expectNoContrastViolations(page);
    });

    test(`${setting}コマンドパレットを開いた画面に、違反がない`, async ({ page }) => {
      emulation = await emulatePreferences(page, { moreContrast });
      await page.goto('/');
      await page.locator('body').click();
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByRole('dialog', { name: 'コマンドパレット' })).toBeVisible();
      await expectNoContrastViolations(page);
      await page.keyboard.press('Escape');
    });

    test(`${setting}ショートカットの一覧（ダイアログ）を開いた画面に、違反がない`, async ({
      page,
    }) => {
      emulation = await emulatePreferences(page, { moreContrast });
      await page.goto('/');
      await page.locator('body').click();
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'ショートカットの一覧' })).toBeVisible();
      await expectNoContrastViolations(page);
      await page.keyboard.press('Escape');
    });
  }
});
