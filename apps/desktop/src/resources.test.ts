import { describe, expect, it } from 'vitest';
import { resolveResources, serverEnv } from './resources';

describe('NFR-01 デスクトップアプリがサーバーに渡す成果物の場所', () => {
  it('開発時はリポジトリの中の成果物を使う', () => {
    expect(
      resolveResources({
        isPackaged: false,
        resourcesPath: '/ignored',
        appDir: '/repo/apps/desktop',
      }),
    ).toEqual({
      serverEntry: '/repo/apps/desktop/dist/server.mjs',
      webDist: '/repo/apps/web/dist',
      prompts: '/repo/prompts',
      migrations: '/repo/packages/db/migrations',
    });
  });

  it('.app にしたときは Resources の中の成果物を使う', () => {
    expect(
      resolveResources({
        isPackaged: true,
        resourcesPath: '/Applications/mymind.app/Contents/Resources',
        appDir: '/ignored',
      }),
    ).toEqual({
      serverEntry: '/Applications/mymind.app/Contents/Resources/server/server.mjs',
      webDist: '/Applications/mymind.app/Contents/Resources/web',
      prompts: '/Applications/mymind.app/Contents/Resources/prompts',
      migrations: '/Applications/mymind.app/Contents/Resources/migrations',
    });
  });

  it('今の環境変数を引き継ぎ、デスクトップアプリであることと成果物の場所を足す', () => {
    const env = serverEnv(
      { MYMIND_DATA_DIR: '/data', MYMIND_PORT: '4820', UNSET: undefined },
      resolveResources({ isPackaged: false, resourcesPath: '', appDir: '/repo/apps/desktop' }),
    );
    expect(env).toEqual({
      MYMIND_DATA_DIR: '/data',
      MYMIND_PORT: '4820',
      MYMIND_DESKTOP: '1',
      MYMIND_WEB_DIST: '/repo/apps/web/dist',
      MYMIND_PROMPTS_DIR: '/repo/prompts',
      MYMIND_MIGRATIONS_DIR: '/repo/packages/db/migrations',
    });
  });
});
