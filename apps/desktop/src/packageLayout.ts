/**
 * `.app` の Resources の中の名前（ADR-0016、#211）。`.app` を作るスクリプト（scripts/packageApp.mjs）と、
 * 起動したアプリが成果物を探す場所（resources.ts）で、同じ名前を使う
 */
export const PACKAGED_RESOURCES = {
  /** 束ねたサーバー（server.mjs と、共有のかけら chunks/） */
  server: 'server',
  /** 画面のビルド（apps/web/dist） */
  web: 'web',
  /** プロンプトと方針（prompts/ の .md） */
  prompts: 'prompts',
  /** マイグレーション（packages/db/migrations） */
  migrations: 'migrations',
  /** アイコンなどの画像（apps/desktop/assets） */
  assets: 'assets',
} as const;

/** 束ねたサーバーの入口のファイル名（vite.config.ts の出力） */
export const SERVER_ENTRY = 'server.mjs';
