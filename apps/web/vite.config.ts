import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// 開発サーバーの設定（ADR-0007、ADR-0010）
const LOOPBACK = '127.0.0.1';
const host = process.env['MYMIND_HOST'] ?? LOOPBACK;
// サーバーと同じく、0.0.0.0 で待ち受けてよいのはコンテナの中だけ
if (host !== LOOPBACK && !(host === '0.0.0.0' && process.env['MYMIND_IN_CONTAINER'] === '1')) {
  throw new Error(
    `MYMIND_HOST=${host} は使えません（0.0.0.0 は MYMIND_IN_CONTAINER=1 のときだけ）`,
  );
}
const apiPort = process.env['MYMIND_PORT'] ?? '4820';
// サーバーの pnpm dev と同じデータディレクトリ（実データの ~/.mymind には触れない）
const dataDir = resolve(process.env['MYMIND_DATA_DIR'] ?? '../../.data');

/**
 * 開発時に、サーバーが書き出したセッショントークンを meta タグで画面に渡す（ADR-0007）。
 * 本番では Hono が同じ名前の meta タグを埋め込む。トークンを返す API は作らない。
 */
function sessionTokenPlugin(): Plugin {
  return {
    name: 'mymind-session-token',
    apply: 'serve',
    transformIndexHtml() {
      const path = join(dataDir, 'session-token');
      if (!existsSync(path)) {
        console.warn(`セッショントークンがありません（${path}）。先にサーバーを起動してください`);
        return [];
      }
      const token = readFileSync(path, 'utf8').trim();
      return [{ tag: 'meta', attrs: { name: 'mymind-token', content: token }, injectTo: 'head' }];
    },
  };
}

export default defineConfig({
  plugins: [react(), sessionTokenPlugin()],
  server: {
    host,
    port: 5173,
    // ポートが変わると Host・Origin の許可リストとずれるので、別のポートは探さない
    strictPort: true,
    watch: { usePolling: process.env['MYMIND_WATCH_POLLING'] === '1' },
    // ブラウザから見て画面と API を同じオリジンにする。Host はそのまま渡す（サーバーが検証する）
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } },
  },
  build: { outDir: 'dist' },
});
