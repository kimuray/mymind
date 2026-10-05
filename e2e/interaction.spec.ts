import { expect, type Locator, type Page, test } from '@playwright/test';

// ホバーと押下の反応（DESIGN.md 2.8、NFR-06、NFR-29）

/** 要素の後ろに重ねたホバーの層（::before）の opacity */
const hoverLayerOpacity = (target: Locator) =>
  target.evaluate((el) => getComputedStyle(el, '::before').opacity);

async function addTask(page: Page, title: string) {
  const input = page.getByLabel('今日のタスクを追加');
  await input.fill(title);
  await input.press('Enter');
  const row = page.locator('.task-row', { hasText: title });
  await expect(row).toBeVisible();
  return row;
}

test.describe('NFR-29 ホバーと押下の反応', () => {
  test('タスクの行にカーソルを乗せると、薄い層が重なる', async ({ page }) => {
    await page.goto('/');
    const row = await addTask(page, 'ホバーを確かめる');
    // 追加欄からカーソルを離した状態から始める
    await page.mouse.move(0, 0);
    expect(await hoverLayerOpacity(row)).toBe('0');
    await row.hover();
    await expect.poll(() => hoverLayerOpacity(row)).toBe('1');
  });

  test('ステータスアイコンを押している間は、アイコンが縮む', async ({ page }) => {
    await page.goto('/');
    const row = await addTask(page, '押下を確かめる');
    const icon = row.locator('.status-icon');
    await icon.hover();
    await page.mouse.down();
    try {
      // scale(0.88) は matrix(0.88, 0, 0, 0.88, 0, 0)
      await expect(icon).toHaveCSS('transform', 'matrix(0.88, 0, 0, 0.88, 0, 0)');
    } finally {
      await page.mouse.up();
    }
    await expect(icon).toHaveCSS('transform', 'none');
  });

  test('主ボタンには、藍色の面の上で見える白の層を重ねる', async ({ page }) => {
    await page.goto('/');
    const primary = page.getByRole('link', { name: /振り返りを書く/ });
    expect(await primary.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe(
      'rgba(255, 255, 255, 0.12)',
    );
  });

  test('使えないボタンには、ホバーの層を重ねない', async ({ page }) => {
    await page.goto('/');
    // 使えない状態はデータの状態に左右されるので、共通のボタンの見た目のものを置いて確かめる
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.className = 'button button-secondary';
      button.disabled = true;
      button.textContent = '使えないボタン';
      document.querySelector('main')?.prepend(button);
    });
    const disabled = page.getByRole('button', { name: '使えないボタン' });
    await disabled.hover({ force: true });
    expect(await hoverLayerOpacity(disabled)).toBe('0');
  });

  test('設定がなければ、ホバーの層は DESIGN.md 2.7 の時間で重なる', async ({ page }) => {
    // E2E は既定で「視差効果を減らす」で動かす（playwright.config.ts）ので、このテストだけ戻す
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      await page.goto('/');
      const nav = page.getByRole('link', { name: /今日/ }).first();
      expect(await nav.evaluate((el) => getComputedStyle(el, '::before').transitionDuration)).toBe(
        '0.12s',
      );
    } finally {
      // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
  });
});

test.describe('FR-T03 状態が変わった直後の動き', () => {
  test('画面を開いたときの行には、動きを付けない', async ({ page }) => {
    await page.goto('/');
    await addTask(page, '開いたときは動かさない');
    await page.reload();
    const row = page.locator('.task-row', { hasText: '開いたときは動かさない' });
    await expect(row).toHaveAttribute('data-changed', 'false');
    await expect(row.locator('.si-glyph')).toHaveAttribute('data-animate', 'false');
  });

  test('完了にすると、アイコンが弾み、タスク名に線を引いてから消す', async ({ page }) => {
    await page.goto('/');
    const row = await addTask(page, '完了の動きを確かめる');
    // 新しく追加した行は、初めて画面に出す状態なので動かさない
    await expect(row.locator('.si-glyph')).toHaveAttribute('data-animate', 'false');
    const icon = row.locator('.status-icon');
    await icon.click();
    await icon.click();
    // 完了にすると行は「完了」の欄へ移って作り直されるが、変わったことは引き継ぐ
    const done = page.locator('.task-row[data-closed="true"]', {
      hasText: '完了の動きを確かめる',
    });
    await expect(done).toHaveAttribute('data-changed', 'true');
    await expect(done.locator('.si-glyph')).toHaveCSS('animation-name', 'si-pop');
    await expect(done.locator('.si-check')).toHaveCSS('animation-name', 'si-check-in');
    const strike = () =>
      done.locator('.task-name').evaluate((el) => {
        const style = getComputedStyle(el, '::after');
        return { name: style.animationName, opacity: style.opacity };
      });
    // 線は引き終えたら消え、完了した行の見た目は今のまま
    await expect.poll(strike).toEqual({ name: 'task-strike-draw, task-strike-fade', opacity: '0' });
  });

  test('着手中にすると、バッジが現れる動きを付ける', async ({ page }) => {
    await page.goto('/');
    const row = await addTask(page, 'バッジの動きを確かめる');
    await row.locator('.status-icon').click();
    await expect(row.locator('.chip')).toHaveCSS('animation-name', 'chip-in');
    await expect(row.locator('.si-fill')).toHaveCSS('animation-name', 'si-fill-grow');
  });
});
