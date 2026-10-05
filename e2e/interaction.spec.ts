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
  // 動きの時間と遅れを確かめるため、このまとまりだけ「視差効果を減らす」を外す（DESIGN.md 2.7）
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

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
    await expect(done.locator('.si-glyph')).toHaveCSS('animation-duration', '0.2s');
    await expect(done.locator('.si-check')).toHaveCSS('animation-name', 'si-check-in');
    // チェックは円より --motion-fast 遅れて現れる
    await expect(done.locator('.si-check')).toHaveCSS('animation-delay', '0.12s');
    const strike = () =>
      done.locator('.task-name').evaluate((el) => {
        const style = getComputedStyle(el, '::after');
        return {
          name: style.animationName,
          duration: style.animationDuration,
          delay: style.animationDelay,
          opacity: style.opacity,
        };
      });
    // 線は引き終えたら消え、完了した行の見た目は今のまま
    await expect.poll(strike).toEqual({
      name: 'task-strike-draw, task-strike-fade',
      // 引くのに --motion-slow、引き終えてから --motion-base で消す
      duration: '0.32s, 0.2s',
      delay: '0s, 0.32s',
      opacity: '0',
    });
  });

  test('着手中にすると、バッジが現れる動きを付ける', async ({ page }) => {
    await page.goto('/');
    const row = await addTask(page, 'バッジの動きを確かめる');
    await row.locator('.status-icon').click();
    await expect(row.locator('.chip')).toHaveCSS('animation-name', 'chip-in');
    await expect(row.locator('.si-fill')).toHaveCSS('animation-name', 'si-fill-grow');
  });
});

test.describe('FR-U01 リストの行の動き', () => {
  // 動きがあることを確かめるため、このまとまりだけ「視差効果を減らす」を外す（DESIGN.md 2.7）。
  // 画面の外の行は動かさないので、ほかのテストで今日のリストに行がたまっていても見えるよう、縦に広げる
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 4000 });
  });
  // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  /** 行に付けた動き（Web Animations）を、行のタスク名ごとに記録する */
  async function recordRowAnimations(page: Page) {
    await page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { __rowAnimations: string[] }).__rowAnimations = log;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes, options) {
        if (typeof options === 'object' && options.id === 'list-motion') {
          log.push(this.querySelector('.task-name')?.textContent ?? '');
        }
        return original.call(this, keyframes, options);
      };
    });
  }
  const rowAnimations = (page: Page) =>
    page.evaluate(() => (window as unknown as { __rowAnimations: string[] }).__rowAnimations);

  test('画面を開いたときは、行を動かさない', async ({ page }) => {
    await page.goto('/');
    await addTask(page, '開いたときの行');
    await page.reload();
    await recordRowAnimations(page);
    await expect(page.locator('.task-row', { hasText: '開いたときの行' })).toBeVisible();
    expect(await rowAnimations(page)).toEqual([]);
  });

  test('並べ替えると、入れ替わった行が元の位置から滑って移る', async ({ page }) => {
    await page.goto('/');
    await addTask(page, '並べ替えの上');
    await addTask(page, '並べ替えの下');
    await recordRowAnimations(page);
    await page.locator('.task-row', { hasText: '並べ替えの下' }).locator('.task-title').click();
    await page.keyboard.press('Meta+ArrowUp');
    await expect
      .poll(async () => (await rowAnimations(page)).sort())
      .toEqual(['並べ替えの上', '並べ替えの下']);
  });

  test('明日へ送った行は、元の場所で消える', async ({ page }) => {
    await page.goto('/');
    await addTask(page, '明日へ送る行');
    await page.locator('.task-row', { hasText: '明日へ送る行' }).locator('.task-title').click();
    await page.keyboard.press('t');
    await expect(
      page.locator('.task-row:not(.list-motion-ghost)', { hasText: '明日へ送る行' }),
    ).toHaveCount(0);
    // 写しは消え終わると取り除かれる
    await expect(page.locator('.list-motion-ghost')).toHaveCount(0);
  });

  test('追加した行は、現れる動きで入る', async ({ page }) => {
    await page.goto('/');
    await addTask(page, '先にある行');
    await recordRowAnimations(page);
    await addTask(page, '追加して現れる行');
    await expect.poll(() => rowAnimations(page)).toContain('追加して現れる行');
  });
});

test.describe('FR-U01 選択のカーソルの動き', () => {
  test('J を続けて押すと、選択の面は今見えている位置から次の行へ向かい直す', async ({ page }) => {
    // 動きがあることを確かめるため、このテストだけ「視差効果を減らす」を外す（DESIGN.md 2.7）。
    // 画面の外の行ではスクロールが混ざるので、行がたまっていても見えるよう縦に広げる
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 4000 });
    try {
      await page.goto('/');
      for (const title of ['続けて押す1', '続けて押す2', '続けて押す3']) await addTask(page, title);
      await page.locator('.task-row', { hasText: '続けて押す1' }).locator('.task-title').click();
      await page.evaluate(() => {
        const log: number[] = [];
        (window as unknown as { __selectionStarts: number[] }).__selectionStarts = log;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes, options) {
          if (typeof options === 'object' && options.id === 'selection-motion') {
            const first = (keyframes as Keyframe[])[0]?.['transform'];
            log.push(new DOMMatrixReadOnly(String(first)).m42);
          }
          return original.call(this, keyframes, options);
        };
      });
      const step = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('.task-row')].filter((r) =>
          r.textContent?.includes('続けて押す'),
        );
        const [a, b] = rows;
        return a !== undefined && b !== undefined ? b.offsetTop - a.offsetTop : 0;
      });
      await page.keyboard.press('j');
      await page.keyboard.press('j');
      const starts = () =>
        page.evaluate(
          () => (window as unknown as { __selectionStarts: number[] }).__selectionStarts,
        );
      await expect.poll(async () => (await starts()).length).toBe(2);
      const [first, second] = await starts();
      // 1回目は1行上から。2回目は、まだ1行目と2行目の間に見えている面から向かうので、1行分より遠い
      expect(first).toBeCloseTo(-step, 0);
      expect(second ?? 0).toBeLessThan(-step - 1);
    } finally {
      // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });

  test('選択中の行には、選択の面を ::after に描く', async ({ page }) => {
    await page.goto('/');
    const row = await addTask(page, '選択の面を確かめる');
    await row.locator('.task-title').click();
    await expect(row).toHaveAttribute('data-selected', 'true');
    const after = await row.evaluate((el) => {
      const style = getComputedStyle(el, '::after');
      return { content: style.content, background: style.backgroundColor };
    });
    expect(after).toEqual({ content: '""', background: 'rgba(255, 255, 255, 0.5)' });
  });

  test('J で選択を動かすと、選択の面が前の行から滑って移る', async ({ page }) => {
    // 動きがあることを確かめるため、このテストだけ「視差効果を減らす」を外す（DESIGN.md 2.7）
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      await page.goto('/');
      await addTask(page, 'カーソルの上');
      await addTask(page, 'カーソルの下');
      await page.locator('.task-row', { hasText: 'カーソルの上' }).locator('.task-title').click();
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { __selectionAnimations: string[] }).__selectionAnimations = log;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes, options) {
          if (typeof options === 'object' && options.id === 'selection-motion') {
            log.push(`${options.pseudoElement}:${this.querySelector('.task-name')?.textContent}`);
          }
          return original.call(this, keyframes, options);
        };
      });
      await page.keyboard.press('j');
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __selectionAnimations: string[] }).__selectionAnimations,
          ),
        )
        .toEqual(['::after:カーソルの下']);
    } finally {
      // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
  });
});

test.describe('FR-U04 画面の切り替え', () => {
  /** 画面の切り替え（View Transitions）を始めたときの種類を記録する */
  async function recordViewTransitions(page: Page) {
    await page.evaluate(() => {
      const log: string[][] = [];
      (window as unknown as { __viewTransitions: string[][] }).__viewTransitions = log;
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = ((arg: StartViewTransitionOptions) => {
        log.push(typeof arg === 'object' && arg !== null ? [...(arg.types ?? [])] : []);
        return original(arg);
      }) as typeof document.startViewTransition;
    });
  }
  const viewTransitions = (page: Page) =>
    page.evaluate(() => (window as unknown as { __viewTransitions: string[][] }).__viewTransitions);

  test('別の画面へ移ると、中身を切り替える', async ({ page }) => {
    await page.goto('/');
    await recordViewTransitions(page);
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await expect(page).toHaveURL(/\/backlog$/);
    expect(await viewTransitions(page)).toEqual([['page']]);
  });

  test('カレンダーで日を選んでも切り替えず、月を移ると向きを付けて切り替える', async ({ page }) => {
    await page.goto('/calendar/2026-10');
    await recordViewTransitions(page);
    await page.locator('.calendar-cell').first().click();
    await expect(page).toHaveURL(/\/calendar\/2026-10\/2026-10-\d\d$/);
    await page.getByRole('link', { name: '次の月' }).click();
    await expect(page).toHaveURL(/\/calendar\/2026-11$/);
    expect(await viewTransitions(page)).toEqual([['forward']]);
  });

  for (const path of ['/', '/settings']) {
    test(`サイドバーの選択中の印は、項目の後ろの面で示す（${path}）`, async ({ page }) => {
      await page.goto(path);
      const active = page.locator('.nav-item.is-active .nav-highlight');
      await expect(active).toHaveCount(1);
      await expect(active).toHaveCSS('opacity', '1');
      await expect(active).toHaveCSS('background-color', 'rgba(47, 75, 124, 0.12)');
    });
  }

  test('どのサイドバーの項目にも、滑らせる選択中の印がある', async ({ page }) => {
    await page.goto('/');
    const items = page.locator('.pane-sidebar .nav-item');
    const count = await items.count();
    await expect(page.locator('.pane-sidebar .nav-item .nav-highlight')).toHaveCount(count);
  });
});

test.describe('FR-U04 詳細ペインの動き', () => {
  test('別のタスクを選ぶと、詳細ペインの中身がフェードインする', async ({ page }) => {
    // 動きがあることを確かめるため、このテストだけ「視差効果を減らす」を外す（DESIGN.md 2.7）
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      await page.goto('/');
      const row = await addTask(page, '詳細の入れ替え');
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { __detailSwaps: string[] }).__detailSwaps = log;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes, options) {
          if (typeof options === 'object' && options.id === 'detail-swap') log.push(this.className);
          return original.call(this, keyframes, options);
        };
      });
      await row.locator('.task-title').click();
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { __detailSwaps: string[] }).__detailSwaps),
        )
        .toEqual(['pane-detail-content']);
    } finally {
      // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
  });

  test('J で続けて選ぶと、詳細ペインの入れ替えの動きを止める', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      await page.goto('/');
      const first = await addTask(page, '続けて選ぶ詳細1');
      await addTask(page, '続けて選ぶ詳細2');
      await first.locator('.task-title').click();
      // 選んだ直後（150ms 未満）に次の行へ移る
      await page.keyboard.press('j');
      const running = await page
        .locator('.pane-detail-content')
        .evaluate((el) => el.getAnimations().filter((a) => a.id === 'detail-swap').length);
      expect(running).toBe(0);
    } finally {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
  });

  test('カレンダーを開いて読み込みが終わったときは、詳細ペインを動かさない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    try {
      await page.addInitScript(() => {
        const log: string[] = [];
        (window as unknown as { __detailSwaps: string[] }).__detailSwaps = log;
        const original = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, keyframes, options) {
          if (typeof options === 'object' && options.id === 'detail-swap') log.push(this.className);
          return original.call(this, keyframes, options);
        };
      });
      await page.goto('/calendar/2026-10');
      await expect(page.locator('.calendar-cell').first()).toBeVisible();
      await expect(page.getByRole('complementary', { name: '詳細' })).not.toContainText(
        '月の記録を読み込んでいます',
      );
      expect(
        await page.evaluate(() => (window as unknown as { __detailSwaps: string[] }).__detailSwaps),
      ).toEqual([]);
    } finally {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
  });

  test('1280px 未満では、詳細ペインを右から滑らせて出し入れする', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    try {
      await page.goto('/');
      const pane = page.getByRole('complementary', { name: '詳細' });
      await expect(pane).toHaveCSS('transition-property', 'transform');
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });
});
