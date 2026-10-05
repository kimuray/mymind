import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * preload を束ねる。sandbox のウィンドウの preload は ESM を読めないので、CommonJS の1ファイルにする（ADR-0015）。
 * vite.config.ts のビルドのあとに、dist を消さずに足す
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node24',
    rollupOptions: {
      input: { preload: fileURLToPath(new URL('./src/preload.ts', import.meta.url)) },
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: '[name].cjs' },
    },
  },
  ssr: { noExternal: true },
});
