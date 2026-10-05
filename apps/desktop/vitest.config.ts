import { defineConfig } from 'vitest/config';

// テストは vite.config.ts（すべてを1ファイルに束ねるビルドの設定）を使わない。
// ssr.noExternal: true がテストの実行にも効くと、カバレッジの計測（node:inspector）まで取り込まれて切れるため
export default defineConfig({
  test: { name: '@mymind/desktop' },
});
