import { expect, type Page, test } from '@playwright/test';

// タスクのタグ（FR-T13、DESIGN.md 4.22）。詳細ペインで付け外しし、リストの行にチップで出す

const unique = (base: string) => `${base}-${Date.now().toString(36)}`;

const detail = (page: Page) => page.getByRole('complementary', { name: '詳細' });
const row = (page: Page, title: string) => page.locator('.task-row', { hasText: title });
const tagInput = (page: Page, title: string) =>
  detail(page).getByRole('combobox', { name: `「${title}」にタグを付ける` });

async function addAndSelect(page: Page, title: string) {
  await page.getByLabel('今日のタスクを追加').fill(title);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: title, exact: true }).click();
  await expect(detail(page)).toContainText(title);
}

async function attach(page: Page, title: string, name: string) {
  await tagInput(page, title).fill(name);
  await tagInput(page, title).press('Enter');
  await expect(detail(page).locator('.tag-chips')).toContainText(name);
}

test.describe('FR-T13 タグの表示と付け外し', () => {
  test('ない名前を打つと色を選んで作って付けられ、行にチップが出る。読み直しても残る', async ({
    page,
  }) => {
    const title = unique('タグを付ける');
    const tag = unique('仕事');
    await page.goto('/');
    await addAndSelect(page, title);
    await tagInput(page, title).fill(tag);
    const picker = detail(page).getByRole('group', { name: `新しいタグ「${tag}」の色` });
    await picker.getByRole('radio', { name: 'あい' }).check();
    await tagInput(page, title).press('Enter');

    const chip = row(page, title).locator('.tag-chip', { hasText: tag });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-color', 'indigo');
    await expect(picker).toHaveCount(0);

    await page.reload();
    await expect(row(page, title).locator('.tag-chip', { hasText: tag })).toHaveAttribute(
      'data-color',
      'indigo',
    );
  });

  test('既にあるタグは候補に出て、色を選ばずにそのタグを付ける', async ({ page }) => {
    const first = unique('先のタスク');
    const second = unique('後のタスク');
    const tag = unique('家');
    await page.goto('/');
    await addAndSelect(page, first);
    await tagInput(page, first).fill(tag);
    await detail(page).getByRole('radio', { name: 'みどり' }).check();
    await tagInput(page, first).press('Enter');
    await expect(row(page, first).locator('.tag-chip')).toHaveText(tag);

    await addAndSelect(page, second);
    await expect(detail(page).locator(`datalist option[value="${tag}"]`)).toHaveCount(1);
    // 大文字・小文字だけが違う名前は同じタグ
    await tagInput(page, second).fill(tag.toUpperCase());
    await expect(detail(page).getByRole('group', { name: /新しいタグ/ })).toHaveCount(0);
    await tagInput(page, second).press('Enter');
    await expect(row(page, second).locator('.tag-chip')).toHaveText(tag);
    await expect(row(page, second).locator('.tag-chip')).toHaveAttribute('data-color', 'green');
  });

  test('外すボタンでタグを外すと、行からも消える', async ({ page }) => {
    const title = unique('タグを外す');
    const tag = unique('外す');
    await page.goto('/');
    await addAndSelect(page, title);
    await attach(page, title, tag);
    await expect(row(page, title).locator('.tag-chip')).toHaveText(tag);
    await detail(page)
      .getByRole('button', { name: `タグ「${tag}」を外す` })
      .click();
    await expect(row(page, title).locator('.tag-chip')).toHaveCount(0);
    await expect(detail(page).locator('.tag-chips')).toHaveCount(0);
  });

  test('# キーで詳細ペインのタグの入力欄へ移る', async ({ page }) => {
    const title = unique('キーで付ける');
    await page.goto('/');
    await addAndSelect(page, title);
    await page.getByRole('button', { name: title, exact: true }).focus();
    await page.keyboard.press('#');
    await expect(tagInput(page, title)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tagInput(page, title)).not.toBeFocused();
  });

  test('1つのタスクに付けられるのは10個まで。行には3つまでを出し、残りは数で出す', async ({
    page,
  }) => {
    const title = unique('タグを10個');
    const base = unique('t');
    await page.goto('/');
    await addAndSelect(page, title);
    for (let i = 1; i <= 10; i++) await attach(page, title, `${base}-${i}`);
    await expect(tagInput(page, title)).toHaveCount(0);
    await expect(detail(page)).toContainText('タグは10個まで付けられます');
    await expect(row(page, title).locator('.tag-chip')).toHaveCount(3);
    await expect(row(page, title).locator('.row-tags-more')).toContainText('+7');

    // 外すとまた付けられる
    await detail(page)
      .getByRole('button', { name: `タグ「${base}-1」を外す` })
      .click();
    await expect(tagInput(page, title)).toBeVisible();
  });

  test('NFR-13 タグを付けた直後にメモを保存しても、版の食い違いで拒否されない', async ({
    page,
  }) => {
    const title = unique('タグとメモ');
    await page.goto('/');
    await addAndSelect(page, title);
    await attach(page, title, unique('メモの前'));
    await detail(page).getByRole('textbox', { name: 'メモ', exact: true }).click();
    await page.keyboard.type('タグの後に書いた');
    await detail(page).getByRole('heading', { level: 2 }).first().click();
    await expect(detail(page).getByText('保存しました')).toBeVisible();
    await expect(row(page, title).locator('.task-note-mark')).toBeVisible();
  });

  test('NFR-13 付いているタグの名前をもう一度打っても送らず、続けてメモを保存できる', async ({
    page,
  }) => {
    const title = unique('同じタグを2回');
    const tag = unique('二度');
    await page.goto('/');
    await addAndSelect(page, title);
    await attach(page, title, tag);
    await tagInput(page, title).fill(tag.toUpperCase());
    await tagInput(page, title).press('Enter');
    await expect(detail(page)).toContainText(`「${tag.toUpperCase()}」は付いています`);
    await expect(detail(page).locator('.tag-chips .tag-chip')).toHaveCount(1);
    await detail(page).getByRole('textbox', { name: 'メモ', exact: true }).click();
    await page.keyboard.type('同じタグの後に書いた');
    await detail(page).getByRole('heading', { level: 2 }).first().click();
    await expect(detail(page).getByText('保存しました')).toBeVisible();
  });
});
