import { join, resolve } from 'node:path';
import { PACKAGED_RESOURCES, SERVER_ENTRY } from './packageLayout';

/** サーバーに渡す成果物の場所（ADR-0016） */
export type Resources = {
  /** 束ねたサーバー（Vite の SSR ビルド） */
  serverEntry: string;
  webDist: string;
  prompts: string;
  migrations: string;
  /** メニューバーのアイコンなど、アプリの画像 */
  assets: string;
};

/**
 * 成果物の場所を決める。`.app` にしたとき（isPackaged）は Resources の中、開発時はリポジトリの中を使う。
 * appDir は apps/desktop（package.json のある場所）
 */
export function resolveResources(input: {
  isPackaged: boolean;
  resourcesPath: string;
  appDir: string;
}): Resources {
  if (input.isPackaged) {
    const at = (name: string) => join(input.resourcesPath, name);
    return {
      serverEntry: join(at(PACKAGED_RESOURCES.server), SERVER_ENTRY),
      webDist: at(PACKAGED_RESOURCES.web),
      prompts: at(PACKAGED_RESOURCES.prompts),
      migrations: at(PACKAGED_RESOURCES.migrations),
      assets: at(PACKAGED_RESOURCES.assets),
    };
  }
  const root = resolve(input.appDir, '../..');
  return {
    serverEntry: join(input.appDir, 'dist', SERVER_ENTRY),
    webDist: join(root, 'apps', 'web', 'dist'),
    prompts: join(root, 'prompts'),
    migrations: join(root, 'packages', 'db', 'migrations'),
    assets: join(input.appDir, 'assets'),
  };
}

/**
 * サーバーの子プロセスに渡す環境変数。今の環境（MYMIND_DATA_DIR、MYMIND_PORT など）に、成果物の場所を足す。
 * 待ち受けは必ず 127.0.0.1 にする（NFR-02）。起動した環境にコンテナ用の設定が残っていても引き継がない
 */
export function serverEnv(
  base: Record<string, string | undefined>,
  resources: Resources,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value;
  return {
    ...env,
    MYMIND_DESKTOP: '1',
    MYMIND_HOST: '127.0.0.1',
    MYMIND_IN_CONTAINER: '0',
    MYMIND_WEB_DIST: resources.webDist,
    MYMIND_PROMPTS_DIR: resources.prompts,
    MYMIND_MIGRATIONS_DIR: resources.migrations,
  };
}
