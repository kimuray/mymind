import { expect, type Page, test } from '@playwright/test';

// 朝の計画（FR-D03〜D05、FR-D09、偽のエージェント）。確定は1日1回なので、確定するテストはこのファイルの最後の1つだけにする。
// 前日の計画は、画面に埋め込まれたトークンを付け、前の日として API で作る

/** 今の業務日（Asia/Tokyo、5時で切り替え。サーバーの初期値と同じ）から n 日前 */
const businessDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - 5 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000),
  );

function callApi(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const token =
        document.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? '';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Mymind-Token': token },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    { path, body },
  );
}

/** 前日の計画にタスクを入れる。status に 'doing' を渡すと着手中にする */
async function planYesterday(page: Page, title: string, status?: 'doing') {
  const day = businessDay(1);
  const screen = { expectedDay: day, allowPastDay: true };
  const created = await callApi(page, '/api/tasks', { title, planFor: 'today', ...screen });
  expect(created.status).toBe(201);
  const task = created.body['task'] as { id: string; version: number };
  if (status !== undefined) {
    const res = await callApi(page, `/api/tasks/${task.id}/transition`, {
      to: status,
      expectedVersion: task.version,
      ...screen,
    });
    expect(res.status).toBe(200);
  }
}

async function addToBacklog(page: Page, title: string) {
  const res = await callApi(page, '/api/tasks', { title, expectedDay: businessDay() });
  expect(res.status).toBe(201);
}

const carryoverRow = (page: Page, title: string) =>
  page.getByRole('list', { name: '持ち越し' }).getByRole('listitem').filter({ hasText: title });

test.describe('FR-D02 前日の FB と調子', () => {
  test('前の日に FB をもらっておくと、朝の計画の詳細ペインに表示され、調子を直せる', async ({
    page,
  }) => {
    await page.goto('/morning');
    const requested = await callApi(page, '/api/jobs', {
      kind: 'daily_feedback',
      period: businessDay(1),
    });
    expect(requested.status).toBe(202);
    const jobId = (requested.body['job'] as { id: string }).id;
    await expect
      .poll(async () =>
        page.evaluate(
          async (id) =>
            ((await (await fetch(`/api/jobs/${id}`)).json()) as { job: { status: string } }).job
              .status,
          jobId,
        ),
      )
      .toBe('succeeded');

    await page.reload();
    const panel = page.getByRole('region', { name: '昨日のフィードバック' });
    await expect(panel.getByRole('heading', { name: '今日の一手' })).toBeVisible();
    await panel
      .getByRole('group', { name: '調子を直す' })
      .getByRole('button', { name: '絶好調' })
      .click();
    await expect(panel.getByText(/手動で修正（AIの判定：/)).toBeVisible();
  });
});

test.describe('FR-D03 FR-D04 FR-D05 朝の計画', () => {
  test('確定する前に画面を離れると、判断も追加も反映しない', async ({ page }) => {
    await page.goto('/morning');
    await planYesterday(page, '離れる前に判断した持ち越し');
    await addToBacklog(page, '離れる前に選んだバックログ');
    await page.reload();

    await carryoverRow(page, '離れる前に判断した持ち越し')
      .getByRole('button', { name: '今日もやる' })
      .click();
    await page
      .getByRole('list', { name: 'バックログから今日へ' })
      .getByRole('listitem')
      .filter({ hasText: '離れる前に選んだバックログ' })
      .getByRole('button', { name: '今日へ' })
      .click();

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('離れる前に判断した持ち越し')).toHaveCount(0);
    await expect(page.getByText('離れる前に選んだバックログ')).toHaveCount(0);

    await page.goto('/morning');
    await expect(
      carryoverRow(page, '離れる前に判断した持ち越し').getByRole('button', { name: '今日もやる' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('朝に持ち越しを判断して確定し、今日の画面で進め、振り返りを書くまで', async ({ page }) => {
    await page.goto('/morning');
    await planYesterday(page, '今日も続ける企画書', 'doing');
    await planYesterday(page, 'もう終わっていた経費精算');
    await planYesterday(page, 'あとに回す週報', 'doing');
    await addToBacklog(page, 'バックログから入れる調査');
    await page.reload();

    await expect(page.getByRole('heading', { name: '昨日の持ち越し' })).toBeVisible();
    // 自分のタスクに判断する（キーでも選べる）
    await carryoverRow(page, '離れる前に判断した持ち越し')
      .getByRole('button', { name: 'バックログへ' })
      .click();
    await carryoverRow(page, '今日も続ける企画書')
      .getByRole('button', { name: '今日もやる' })
      .click();
    await carryoverRow(page, 'もう終わっていた経費精算')
      .getByRole('button', { name: '実は終わった' })
      .click();
    await carryoverRow(page, 'あとに回す週報').locator('.morning-row-main').click();
    await page.keyboard.press('2');
    await expect(
      carryoverRow(page, 'あとに回す週報').getByRole('button', { name: 'バックログへ' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // 他のテストが前日の計画に入れたタスクも候補に出るので、残りはバックログへ送る
    const rows = page.getByRole('list', { name: '持ち越し' }).getByRole('listitem');
    for (const row of await rows.all()) {
      if ((await row.locator('[aria-pressed="true"]').count()) === 0) {
        await row.getByRole('button', { name: 'バックログへ' }).click();
      }
    }
    const count = await rows.count();
    await expect(page.getByText(`${count} / ${count} 件を判断済み`)).toBeVisible();

    // バックログのタスクは、選んで T でも追加できる
    await page
      .getByRole('list', { name: 'バックログから今日へ' })
      .getByRole('listitem')
      .filter({ hasText: 'バックログから入れる調査' })
      .locator('.morning-row-main')
      .click();
    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: '今日に追加済み' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByText(/今日の計画を確定しました/)).toBeVisible();

    // 今日の画面：持ち越しと追加が入り、バックログへ送ったものと終わったものは入らない
    await page.getByRole('link', { name: '今日の画面へ' }).click();
    const task = (title: string) => page.getByRole('button', { name: new RegExp(`^${title}：`) });
    await expect(task('今日も続ける企画書')).toBeVisible();
    await expect(task('バックログから入れる調査')).toBeVisible();
    await expect(task('あとに回す週報')).toHaveCount(0);
    await expect(task('もう終わっていた経費精算')).toHaveCount(0);
    // 状態のアイコンを押すと次の状態へ進む（着手中 → 完了）
    await task('今日も続ける企画書').click();
    await expect(page.getByRole('button', { name: /^今日も続ける企画書：完了/ })).toBeVisible();

    // 振り返り：その日の記録に完了と変化が出て、書いて保存できる
    await page.goto('/reflection');
    const summary = page.getByRole('region', { name: 'この日の記録' });
    await expect(summary).toContainText('今日も続ける企画書');
    await expect(summary).toContainText('もう終わっていた経費精算');
    await expect(summary).toContainText('あとに回す週報：着手中 → 中断');
    const editor = page.getByRole('textbox', { name: '思考の整理' });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('朝に計画して、企画書を終えた');
    await page.getByRole('button', { name: /^保存のみ/ }).click();
    await expect(page.locator('.reflection-notice')).toHaveText('保存しました');

    // 確定した後は、朝の計画に候補を出さない
    await page.goto('/morning');
    await expect(page.getByText(/今日の計画を確定しました/)).toBeVisible();
  });
});
