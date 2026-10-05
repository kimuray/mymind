import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * デスクトップアプリのメインプロセスと、子プロセスで動かすサーバーを、それぞれ1つの ESM ファイルに束ねる（ADR-0016）。
 * utilityProcess では tsx が効かないので、サーバーも JS にしてから動かす。Node.js の組み込みと electron は束ねない
 */
const external = ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node24',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
        server: fileURLToPath(new URL('../server/src/main.ts', import.meta.url)),
      },
      external,
      output: {
        format: 'es',
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
      },
    },
  },
  ssr: { noExternal: true },
});
