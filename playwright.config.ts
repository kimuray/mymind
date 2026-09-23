import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// 手元で 4820 が使用中（Docker の開発環境など）のときは MYMIND_E2E_PORT で変えられる
const port = Number(process.env['MYMIND_E2E_PORT'] ?? 4820);
// pnpm start は apps/server で動くので、データディレクトリは絶対パスで渡す
const dataDir = fileURLToPath(new URL('./.data/e2e', import.meta.url));

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
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
      MYMIND_DATA_DIR: dataDir,
    },
  },
});
