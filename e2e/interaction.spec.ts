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

  test('副ボタンは出っぱり、押している間はくぼみの層が現れる', async ({ page }) => {
    await page.goto('/');
    // 押すと画面の状態が変わるボタンを避け、共通のボタンの見た目のものを置いて確かめる
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.className = 'button button-secondary';
      button.textContent = 'くぼみを確かめる';
      document.querySelector('main')?.prepend(button);
    });
    const button = page.getByRole('button', { name: 'くぼみを確かめる' });
    await expect(button).toBeVisible();
    // 出っぱりは、外側の影と、縁の面取り（内側の影）で表す（ADR-0019）
    await expect(button).toHaveCSS('box-shadow', /inset/);
    const pressLayer = () => button.evaluate((el) => getComputedStyle(el, '::after').opacity);
    expect(await pressLayer()).toBe('0');
    await button.hover();
    await page.mouse.down();
    try {
      await expect.poll(pressLayer).toBe('1');
    } finally {
      await page.mouse.up();
    }
    await expect.poll(pressLayer).toBe('0');
  });

  test('入力欄は、地の色のくぼみで表す', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('.add-task').first();
    await expect(input).toHaveCSS('background-color', 'rgb(228, 233, 240)');
    await expect(input).toHaveCSS('box-shadow', /inset/);
  });

  test('主ボタンには、藍色の面の上で見える白の層を重ねる', async ({ page }) => {
    await page.goto('/');
    const primary = page.getByRole('link', { name: /振り返りを書く/ });
    expect(await primary.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe(
      'rgba(255, 255, 255, 0.08)',
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
    // 読み込みの前から記録する。reload の後で記録を始めると、計画が届く速さで記録できる動きが変わる（#247）
    await page.addInitScript(() => {
      const log: { id: string; key: string }[] = [];
      (window as unknown as { __openAnimations: typeof log }).__openAnimations = log;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes, options) {
        if (typeof options === 'object' && typeof options.id === 'string') {
          log.push({ id: options.id, key: (this as HTMLElement).dataset['motionKey'] ?? '' });
        }
        return original.call(this, keyframes, options);
      };
    });
    await page.reload();
    await expect(page.locator('.task-row', { hasText: '開いたときの行' })).toBeVisible();
    // 動きが付くなら、計画が届いて描いた直後に付く。描き終わるのを待ってから見る
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    const log = await page.evaluate(
      () =>
        (window as unknown as { __openAnimations: { id: string; key: string }[] }).__openAnimations,
    );
    // 行の移動は1つもない
    expect(log.filter((a) => a.id === 'list-motion')).toEqual([]);
    // 読み込み中を経たときのフェードインは、外側の面（ui:）だけで、行には付かない（DESIGN.md 4.19）
    expect(log.filter((a) => a.id === 'list-fade-in').every((a) => a.key.startsWith('ui:'))).toBe(
      true,
    );
  });

  test('計画が届くのが遅くても、開いたときは行を動かさず、外側の面だけをフェードインする', async ({
    page,
  }) => {
    await page.goto('/');
    await addTask(page, '遅く届く計画の行');
    // CI のように計画の応答が遅いときを再現する（#247）
    await page.route('**/api/days/*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await page.addInitScript(() => {
      const log: { id: string; key: string }[] = [];
      (window as unknown as { __openAnimations: typeof log }).__openAnimations = log;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes, options) {
        if (typeof options === 'object' && typeof options.id === 'string') {
          log.push({ id: options.id, key: (this as HTMLElement).dataset['motionKey'] ?? '' });
        }
        return original.call(this, keyframes, options);
      };
    });
    await page.reload();
    await expect(page.locator('.task-row', { hasText: '遅く届く計画の行' })).toBeVisible();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    const log = await page.evaluate(
      () =>
        (window as unknown as { __openAnimations: { id: string; key: string }[] }).__openAnimations,
    );
    expect(log.filter((a) => a.id === 'list-motion')).toEqual([]);
    const fades = log.filter((a) => a.id === 'list-fade-in');
    expect(fades.length).toBeGreaterThan(0);
    expect(fades.every((a) => a.key.startsWith('ui:'))).toBe(true);
    await page.unroute('**/api/days/*');
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

test.describe('FR-U02 / FR-U03 ダイアログの開閉', () => {
  test.beforeEach(async ({ page }) => {
    // 動きがあることを確かめるため、このまとまりだけ「視差効果を減らす」を外す（DESIGN.md 2.7）
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('コマンドパレットは、開く動きの途中でも打った文字を受け付ける', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+k');
    // 開いてすぐに打つ（開く動きの終わりを待たない）
    await page.keyboard.type('バックログ');
    await expect(page.getByRole('combobox')).toHaveValue('バックログ');
    await expect(page.locator('.dialog-backdrop:not(.dialog-leaving)')).toHaveCSS(
      'animation-name',
      'overlay-in',
    );
  });

  test('閉じると、写しが消えてから取り除かれ、フォーカスはすぐ戻る', async ({ page }) => {
    await page.goto('/');
    const input = page.getByLabel('今日のタスクを追加');
    await input.focus();
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.evaluate(() => {
      const seen: boolean[] = [];
      (window as unknown as { __ghosts: boolean[] }).__ghosts = seen;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.classList.contains('dialog-leaving')) {
              seen.push(n.inert && n.getAttribute('aria-hidden') === 'true');
            }
          }
        }
      }).observe(document.body, { childList: true });
    });
    await page.keyboard.press('Escape');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __ghosts: boolean[] }).__ghosts))
      .toEqual([true]);
    // 写しは操作も読み上げも受けず、フォーカスは開く前の場所へ戻る
    await expect(input).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.dialog-leaving')).toHaveCount(0);
  });

  test('視差効果を減らす設定では、閉じたときに写しを出さない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'ショートカットの一覧' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog-leaving')).toHaveCount(0);
  });
});

test.describe('FR-T06 提案や通知の出入り', () => {
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

  test('通知が出るとリストの面が押し下げられる動きになり、中の行は二重に動かない', async ({
    page,
  }) => {
    await page.goto('/');
    await addTask(page, '通知の上の行');
    const parent = await addTask(page, '通知の親');
    const child = await addTask(page, '通知の子');
    await child.locator('.task-title').click();
    await page.keyboard.press('Tab');
    await expect(page.locator('.task-row[data-depth="1"]', { hasText: '通知の子' })).toBeVisible();
    await page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { __motions: string[] }).__motions = log;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes, options) {
        if (typeof options === 'object' && options.id === 'list-motion') {
          log.push((this as HTMLElement).dataset['motionKey'] ?? '');
        }
        return original.call(this, keyframes, options);
      };
    });
    // 子を持つタスクを子にしようとすると、通知が出る
    await parent.locator('.task-title').click();
    await page.keyboard.press('Tab');
    await expect(page.getByText('タスクの親子は2階層までです')).toBeVisible();
    const motions = () =>
      page.evaluate(() => (window as unknown as { __motions: string[] }).__motions);
    await expect.poll(motions).toContain('ui:notice');
    expect(await motions()).toContain('ui:open');
    // 面の中の行は、面と一緒に動くので個別には動かさない
    expect((await motions()).filter((k) => !k.startsWith('ui:'))).toEqual([]);

    // 閉じると、通知の写しが消えてから取り除かれる
    await page
      .locator('.suggestions', { hasText: 'タスクの親子は2階層までです' })
      .getByRole('button', { name: '閉じる' })
      .click();
    await expect(page.getByText('タスクの親子は2階層までです')).toHaveCount(0);
    await expect(page.locator('.list-motion-ghost')).toHaveCount(0);
  });
});

test.describe('NFR-03 読み込み中と処理中', () => {
  test('すぐ読み込めたときは、読み込み中の表示を出さない', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('今日のタスクを追加')).toBeVisible();
    await expect(page.getByText('読み込んでいます…')).toHaveCount(0);
  });

  test('読み込みが長いときだけ、読み込み中の表示を出す', async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/days/*', async (route) => {
      if (route.request().method() === 'GET') await held;
      await route.continue();
    });
    try {
      await page.goto('/');
      await expect(page.getByRole('status').filter({ hasText: '読み込んでいます…' })).toBeVisible();
      release();
      await expect(page.getByText('読み込んでいます…')).toHaveCount(0);
    } finally {
      release();
      await page.unroute('**/api/days/*');
    }
  });

  test('保存しているあいだ、押したボタンだけを処理中として示す', async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/days/*/log', async (route) => {
      if (route.request().method() === 'PUT') await held;
      await route.continue();
    });
    try {
      await page.goto('/reflection');
      await page.getByRole('textbox', { name: '思考の整理' }).fill('処理中を確かめる');
      const saveOnly = page.getByRole('button', { name: /保存のみ/ });
      await saveOnly.click();
      await expect(saveOnly).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByRole('button', { name: /保存してFBをもらう/ })).not.toHaveAttribute(
        'aria-busy',
      );
      release();
      await expect(saveOnly).not.toHaveAttribute('aria-busy');
      await expect(page.getByText('保存しました', { exact: true })).toBeVisible();
    } finally {
      release();
      await page.unroute('**/api/days/*/log');
    }
  });

  test('設定を保存すると、「保存しました」を短く出す', async ({ page }) => {
    await page.goto('/settings');
    const section = page.getByRole('region', { name: '通知の設定' });
    const eveningTime = section.getByLabel('夜の通知の時刻');
    await expect(eveningTime).toHaveValue('21:30');
    try {
      await eveningTime.fill('22:05');
      await expect(section.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible();
    } finally {
      await eveningTime.fill('21:30');
      await expect
        .poll(async () => {
          const res = await page.request.get('/api/settings');
          const body = (await res.json()) as { settings: Record<string, unknown> };
          return JSON.stringify(body.settings);
        })
        .toContain('21:30');
    }
  });
});

test.describe('NFR-03 読み込みが終わったときのフェードイン', () => {
  test.beforeEach(async ({ page }) => {
    // 動きがあることを確かめるため、このまとまりだけ「視差効果を減らす」を外す（DESIGN.md 2.7）
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __loadFades: string[] }).__loadFades = log;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (this: Element, keyframes, options) {
        if (typeof options === 'object' && options.id === 'load-fade') log.push(this.className);
        return original.call(this, keyframes, options);
      };
    });
  });
  // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });
  const loadFades = (page: Page) =>
    page.evaluate(() => (window as unknown as { __loadFades: string[] }).__loadFades);

  test('カレンダーの月の記録を読み込んでから出すときは、フェードインさせる', async ({ page }) => {
    await page.goto('/calendar/2026-10');
    await expect(page.locator('.calendar-grid')).toBeVisible();
    await expect.poll(() => loadFades(page)).toEqual([expect.stringContaining('calendar-grid')]);
  });
});

test.describe('FR-A05 マメの表情と FB の到着の動き', () => {
  test.beforeEach(async ({ page }) => {
    // 動きがあることを確かめるため、このまとまりだけ「視差効果を減らす」を外す（DESIGN.md 2.7）
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('並んだマメは、最初に描くときには動かさない', async ({ page }) => {
    await page.goto('/dev/mame');
    const figures = page.locator('.mame-figure[data-animate="true"]');
    await expect(page.locator('.mame-figure').first()).toBeVisible();
    await expect(figures).toHaveCount(0);
  });

  test('FB が届くと、マメが考え中から弾んで表情を変え、本文が上から順に現れる', async ({
    page,
  }) => {
    await page.goto('/reflection');
    const mame = page.locator('.feedback-mame .mame-figure');
    await page.getByRole('textbox', { name: '思考の整理' }).fill('動きを確かめる振り返り');
    await page.getByRole('button', { name: '保存してFBをもらう' }).click();
    await expect(page.getByText('マメが考えています')).toBeVisible();
    // 考え中のあいだは、ゆっくり上下する
    await expect(page.locator('.feedback-mame .mame[data-mood="think"] .mame-figure')).toHaveCSS(
      'animation-name',
      /mame-bob/,
    );
    await expect(page.getByRole('heading', { name: '明日の一手' })).toBeVisible();
    await expect(mame).toHaveAttribute('data-animate', 'true');
    await expect(mame).toHaveCSS('animation-name', 'mame-pop');
    const body = page.locator('.feedback-body');
    await expect(body).toHaveAttribute('data-arrived', 'true');
    await expect(body.locator('> .feedback-section').first()).toHaveCSS(
      'animation-name',
      'feedback-in',
    );
    await expect(body.locator('> :nth-child(2)')).toHaveCSS('animation-delay', '0.12s');
  });

  test('開いたときにすでにある FB は、動かさずに出す', async ({ page }) => {
    await page.goto('/reflection');
    // このテストの中で FB を用意してから開き直す（ほかのテストの順序に頼らない）
    await page.getByRole('textbox', { name: '思考の整理' }).fill('開き直す前の振り返り');
    await page.getByRole('button', { name: '保存してFBをもらう' }).click();
    // 押した直後はまだ前の FB が見えているので、生成中を経て届くまで待ってから開き直す
    await expect(page.getByText('マメが考えています')).toBeVisible();
    await expect(page.getByText('マメが考えています')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '明日の一手' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '明日の一手' })).toBeVisible();
    await expect(page.locator('.feedback-body')).toHaveAttribute('data-arrived', 'false');
    await expect(page.locator('.feedback-mame .mame-figure')).toHaveAttribute(
      'data-animate',
      'false',
    );
  });

  test('調子を選ぶと、選んだマメが小さく弾む', async ({ page }) => {
    await page.goto('/reflection');
    const picker = page.getByRole('group', { name: '調子を直す' });
    await expect(picker.locator('.condition-mame[data-picked="true"]')).toHaveCount(0);
    await picker.getByRole('button', { name: /好調/ }).first().click();
    await expect(picker.locator('.condition-mame[data-picked="true"]')).toHaveCSS(
      'animation-name',
      'mame-pick',
    );
  });
});

test.describe('FR-R06 / NFR-29 件数と進み具合の変化', () => {
  test.beforeEach(async ({ page }) => {
    // 動きがあることを確かめるため、このまとまりだけ「視差効果を減らす」を外す（DESIGN.md 2.7）
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  // サンドボックスの中ではページを使い回すので、ほかのテストのために戻す
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('今日の件数は、開いたときは動かさず、増えたら数字を下から入れる', async ({ page }) => {
    await page.goto('/');
    const todo = page.locator('.chip[data-status="todo"] .animated-number-value');
    await expect(todo).toHaveAttribute('data-change', 'none');
    const before = Number(await todo.textContent());
    await addTask(page, '件数を増やす');
    await expect(todo).toHaveText(String(before + 1));
    await expect(todo).toHaveAttribute('data-change', 'up');
    await expect(todo).toHaveCSS('animation-name', 'number-up');
  });

  test('件数が減ったら、数字を上から入れる', async ({ page }) => {
    await page.goto('/');
    const row = await addTask(page, '件数を減らす');
    const todo = page.locator('.chip[data-status="todo"] .animated-number-value');
    const before = Number(await todo.textContent());
    // 未着手から着手中へ進めると、未着手の件数が1つ減る
    await row.locator('.status-icon').click();
    await expect(todo).toHaveText(String(before - 1));
    await expect(todo).toHaveAttribute('data-change', 'down');
    await expect(todo).toHaveCSS('animation-name', 'number-down');
  });
});
