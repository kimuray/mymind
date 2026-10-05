import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// 手元で 4820 が使用中（Docker の開発環境など）のときは MYMIND_E2E_PORT で変えられる
const port = Number(process.env['MYMIND_E2E_PORT'] ?? 4820);
// pnpm start は apps/server で動くので、データディレクトリは絶対パスで渡す
const dataDir = fileURLToPath(new URL('./.data/e2e', import.meta.url));
// Claude Code のサンドボックス（SANDBOX_RUNTIME=1）は Mach サービスの登録を禁じており、
// Chromium はプロセス間の通信に使う MachPortRendezvousServer を登録できずに落ちる（#15）。
// 子プロセスを作らない --single-process なら登録が要らないので、サンドボックスの中だけで使う。
// --single-process では2つ目の BrowserContext を作るとブラウザが落ちるため、reuseContext で
// 1つのコンテキストをテスト間で使い回す（状態は Playwright がテストごとに消す）
const isClaudeSandbox = process.env['SANDBOX_RUNTIME'] === '1';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // すべてのテストが1つのサーバー（1つの DB）を共有するので、並行させると互いのタスクが混ざる
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // 動きの途中の状態を確かめてしまわないよう、「視差効果を減らす」で動かす（DESIGN.md 2.7）。
    // 動きがあることを確かめるテストは、ページごとに no-preference に戻す（e2e/accessibility.spec.ts）
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(isClaudeSandbox
          ? { launchOptions: { args: ['--single-process'] }, reuseContext: true }
          : {}),
      },
    },
  ],
  webServer: {
    // ADR-0007：E2E は本番ビルドに対して実行する。毎回空のデータディレクトリから始める
    command: `rm -rf "${dataDir}" && pnpm build && pnpm start`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    env: {
      MYMIND_PORT: String(port),
      MYMIND_AGENT: 'fake',
      // 生成中の表示とキャンセルを確かめられるよう、偽のアダプタは少し待ってから答える
      MYMIND_FAKE_AGENT_DELAY_MS: '1500',
      MYMIND_DATA_DIR: dataDir,
    },
  },
});
