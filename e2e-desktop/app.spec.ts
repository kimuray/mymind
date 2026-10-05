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
});
