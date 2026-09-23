import { defineConfig, devices } from '@playwright/test';

const port = 4820;

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
    // ADR-0007：E2E は本番ビルドに対して実行する（start スクリプトは issue 005 で用意）
    command: 'pnpm build && pnpm start',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env['CI'],
    env: {
      MYMIND_PORT: String(port),
      MYMIND_AGENT: 'fake',
      MYMIND_DATA_DIR: './.data/e2e',
    },
  },
});
