import { defineConfig } from '@playwright/test';

/**
 * デスクトップアプリ（Electron）の起動を確かめる E2E（ADR-0015、ADR-0016）。
 * 画面の操作は e2e/ でブラウザに対して確かめるので、ここではアプリとしての動き（起動、サーバーの見守り）だけを見る。
 * Electron は Claude Code のサンドボックスの中では起動できないので、CI（Linux、仮想ディスプレイ）で動かす
 */
export default defineConfig({
  testDir: 'e2e-desktop',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
});
