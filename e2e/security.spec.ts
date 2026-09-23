import { expect, test } from '@playwright/test';

// 本番ビルドを Hono が配信した状態で、ローカルサーバーの保護が画面と噛み合っていることを確かめる（ADR-0007）

test.describe('NFR-02 本番の画面とローカルサーバーの保護', () => {
  test('画面を開いても CSP 違反が出ない', async ({ page }) => {
    const violations: string[] = [];
    await page.exposeFunction('reportCspViolation', (v: string) => violations.push(v));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { reportCspViolation: (v: string) => void }).reportCspViolation(
          `${e.violatedDirective} ${e.blockedURI}`,
        );
      });
    });

    for (const path of ['/', '/backlog', '/timeline', '/dev/mame']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    expect(violations).toEqual([]);
  });

  test('画面に埋め込まれたトークンを付ければ状態を変えられ、付けなければ拒否される', async ({
    page,
  }) => {
    await page.goto('/');
    const statuses = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="mymind-token"]')?.getAttribute('content');
      const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);
      const body = JSON.stringify({ title: 'E2E のタスク', expectedDay: day });
      const post = (headers: Record<string, string>) =>
        fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body,
        }).then((r) => r.status);
      return {
        withToken: await post({ 'X-Mymind-Token': token ?? '' }),
        withoutToken: await post({}),
      };
    });
    expect(statuses).toEqual({ withToken: 201, withoutToken: 403 });
  });
});
