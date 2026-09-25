import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// 透明度・動きの設定への対応（NFR-22）とコントラストの検査（NFR-06）

/** OS の「透明度を下げる」「視差効果を減らす」を Chromium でエミュレートする */
async function emulatePreferences(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-transparency', value: 'reduce' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  });
}

async function addTask(page: Page, title: string) {
  const input = page.getByLabel('今日のタスクを追加');
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('button', { name: new RegExp(`^${title}：`) })).toBeVisible();
}

test.describe('NFR-22 透明度・動きの設定への対応', () => {
  test('透明度を下げる設定では、ガラスの面を不透明にし、背景のにじみを消す', async ({ page }) => {
    await emulatePreferences(page);
    await page.goto('/');
    const sidebar = page.getByRole('navigation', { name: '画面' });
    await expect(sidebar).toHaveCSS('backdrop-filter', 'none');
    await expect(sidebar).toHaveCSS('background-color', 'rgb(251, 249, 245)');
    await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  });

  test('視差効果を減らす設定では、マメの考え中の泡を動かさない', async ({ page }) => {
    await emulatePreferences(page);
    await page.goto('/dev/mame');
    await expect(page.locator('.mame-bubbles').first()).toHaveCSS('animation-name', 'none');
  });

  test('設定がなければ、ガラスの面とマメの泡の動きはそのまま', async ({ page }) => {
    await page.goto('/dev/mame');
    await expect(page.getByRole('navigation', { name: '画面' })).not.toHaveCSS(
      'backdrop-filter',
      'none',
    );
    await expect(page.locator('.mame-bubbles').first()).toHaveCSS('animation-name', 'mame-think');
  });
});

test.describe('NFR-06 コントラスト', () => {
  for (const [name, path] of [
    ['今日', '/'],
    ['バックログ', '/backlog'],
    ['マメの表情', '/dev/mame'],
  ] as const) {
    test(`${name}の画面に、WCAG 2 AA のコントラストの違反がない`, async ({ page }) => {
      // ガラスの面とにじみの背景では、axe が文字の背景色を決められず判定できない（incomplete）ので、
      // 不透明な面にした状態で検査する。ガラスの面の文字色の確認は、トークンの値の検査で補う
      await emulatePreferences(page);
      await page.goto('/');
      await addTask(page, `コントラスト確認（${name}）`);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
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
    });
  }
});
