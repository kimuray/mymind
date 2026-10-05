import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test';

// 先に pnpm build（apps/desktop の dist と apps/web の dist）が要る
const appDir = fileURLToPath(new URL('../apps/desktop', import.meta.url));
const PORT = '4851';

let dataDir: string;
let app: ElectronApplication;

test.beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'mymind-desktop-'));
  app = await electron.launch({
    // Linux の CI では Chromium のサンドボックスの補助（chrome-sandbox）に権限を付けられないので外す
    args: [appDir, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      MYMIND_DATA_DIR: dataDir,
      MYMIND_PORT: PORT,
      MYMIND_AGENT: 'fake',
    },
  });
});

test.afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** サーバーのロックファイルにある PID（サーバーの子プロセス） */
const serverPid = () => Number(readFileSync(join(dataDir, 'mymind.lock'), 'utf8').trim());

test.describe('NFR-01 デスクトップアプリ', () => {
  test('起動するとサーバーを子プロセスで動かし、ウィンドウに今日の画面を開く', async () => {
    const window = await app.firstWindow();
    await expect(window.getByLabel('今日のタスクを追加')).toBeVisible({ timeout: 30_000 });
    expect(new URL(window.url()).origin).toBe(`http://127.0.0.1:${PORT}`);
    // 画面に Node.js の API を渡していない（ADR-0015）
    expect(await window.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
      'undefined',
    );
  });

  test('サーバーが異常終了したら起動し直し、ウィンドウを読み直す', async () => {
    const window = await app.firstWindow();
    await expect(window.getByLabel('今日のタスクを追加')).toBeVisible({ timeout: 30_000 });
    const before = serverPid();
    process.kill(before, 'SIGKILL');
    await expect
      .poll(
        () => {
          try {
            return serverPid();
          } catch {
            return before;
          }
        },
        { timeout: 30_000 },
      )
      .not.toBe(before);
    await expect(window.getByLabel('今日のタスクを追加')).toBeVisible({ timeout: 30_000 });
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    expect(res.status).toBe(200);
  });

  test('NFR-27 ウィンドウを閉じてもアプリとサーバーは動き続ける', async () => {
    const window = await app.firstWindow();
    await expect(window.getByLabel('今日のタスクを追加')).toBeVisible({ timeout: 30_000 });
    await window.close();
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    expect(res.status).toBe(200);
  });

  test('NFR-27 設定の画面に、デスクトップアプリの節を出す（開発用の起動では切り替えられない）', async () => {
    const window = await app.firstWindow();
    await expect(window.getByLabel('今日のタスクを追加')).toBeVisible({ timeout: 30_000 });
    await window.goto(`http://127.0.0.1:${PORT}/settings`);
    const section = window.getByRole('region', { name: 'デスクトップアプリ' });
    await expect(section).toContainText('ログイン時に起動する');
    await expect(section.getByRole('checkbox')).toBeDisabled();
    await expect(section).toContainText('開発用の起動では切り替えられません');
  });

  test('FR-N05 設定の状態に、デスクトップアプリの通知を使うことを出す', async () => {
    const window = await app.firstWindow();
    await expect(window.getByLabel('今日のタスクを追加')).toBeVisible({ timeout: 30_000 });
    await window.goto(`http://127.0.0.1:${PORT}/settings`);
    const row = window.getByRole('button', { name: /^通知/ });
    await expect(row).toContainText('デスクトップアプリの通知');
    await expect(row).toContainText('使えます');
  });

  test('FR-U01 アプリのメニューは mymind・編集・表示・ウィンドウ', async () => {
    await app.firstWindow();
    const labels = await app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
    );
    expect(labels).toEqual(['mymind', '編集', '表示', 'ウィンドウ']);
  });

  test('FR-U01 閉じる前の大きさと位置で、ウィンドウを開き直す', async () => {
    const window = await app.firstWindow();
    await expect(window.getByLabel('今日のタスクを追加')).toBeVisible({ timeout: 30_000 });
    const bounds = { x: 40, y: 60, width: 1100, height: 760 };
    await app.evaluate(
      ({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0]?.setBounds(b),
      bounds,
    );
    await window.close();
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);
    // Dock のアイコンを押したときと同じ
    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);
    const reopened = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getBounds(),
    );
    expect(reopened).toMatchObject({ width: 1100, height: 760 });
  });
});
