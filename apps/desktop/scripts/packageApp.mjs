// 自分用の mymind.app を作る（ADR-0015、ADR-0016、#211）。署名と公証はしない。
// 先に pnpm build（apps/web と apps/desktop の dist）が要る。ルートの pnpm desktop:package がまとめて行う。
//
// .app の中身
//   Contents/Resources/app/          メインプロセス（package.json、dist/main.mjs・preload.cjs・chunks/）
//   Contents/Resources/server/       束ねたサーバー（server.mjs、chunks/）
//   Contents/Resources/web/          画面のビルド
//   Contents/Resources/prompts/      プロンプトと方針（評価用の eval/ は入れない）
//   Contents/Resources/migrations/   マイグレーション
//   Contents/Resources/assets/       アイコン
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { APP_BUNDLE_ID } from '../src/appInstall.ts';
import { BUILD_INFO_FILE } from '../src/buildInfo.ts';
import { PACKAGED_RESOURCES, SERVER_ENTRY } from '../src/packageLayout.ts';

const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const root = join(desktopDir, '..', '..');
const stage = join(desktopDir, 'out', 'stage');
const dist = join(desktopDir, 'dist');

const required = [
  join(dist, 'main.mjs'),
  join(dist, 'preload.cjs'),
  join(dist, SERVER_ENTRY),
  join(root, 'apps', 'web', 'dist', 'index.html'),
];
const missing = required.filter((p) => !existsSync(p));
if (missing.length > 0) {
  console.error(
    `先に pnpm build を実行してください。見つからないファイル:\n  ${missing.join('\n  ')}`,
  );
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
const stageApp = join(stage, 'app');
mkdirSync(stageApp, { recursive: true });

// メインプロセス（main.mjs、preload.cjs と、サーバーと共有のかけら chunks/）。サーバーは Resources/server に分ける
const isServerEntry = (src) => src.startsWith(join(dist, SERVER_ENTRY));
const isMainEntry = (src) =>
  src.startsWith(join(dist, 'main.mjs')) || src.startsWith(join(dist, 'preload.cjs'));
cpSync(dist, join(stageApp, 'dist'), { recursive: true, filter: (src) => !isServerEntry(src) });
const desktopPackage = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(
  readFileSync(join(desktopDir, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
// アプリの版は、ルートの package.json の version（まだ決めていなければ 0.0.0）。ビルド番号にはコミットを入れ、
// 作り直すたびに「この .app をどのコミットから作ったか」を、Finder の情報（CFBundleVersion）で見分けられるようにする
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appVersion = typeof rootPackage.version === 'string' ? rootPackage.version : '0.0.0';
const fullCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    // git がない環境（展開したソースなど）でも作れるようにする
    return null;
  }
})();
const commit = fullCommit === null ? 'unknown' : fullCommit.slice(0, 7);
writeFileSync(
  join(stageApp, 'package.json'),
  `${JSON.stringify({ name: 'mymind', productName: 'mymind', version: appVersion, type: 'module', main: desktopPackage.main }, null, 2)}\n`,
);

// アプリが更新を確かめるときに読む、作ったコミットとリポジトリの場所（FR-U05、ADR-0017）。
// git のない環境で作った .app には置かない（アプリは更新の項目を出さない）
if (fullCommit !== null) {
  writeFileSync(
    join(stageApp, BUILD_INFO_FILE),
    `${JSON.stringify({ commit: fullCommit, repoPath: root }, null, 2)}\n`,
  );
}

// Resources に入れるもの。名前は起動したアプリが探す名前（packageLayout.ts）と同じにする
const resources = {
  [PACKAGED_RESOURCES.server]: dist,
  [PACKAGED_RESOURCES.web]: join(root, 'apps', 'web', 'dist'),
  [PACKAGED_RESOURCES.prompts]: join(root, 'prompts'),
  [PACKAGED_RESOURCES.migrations]: join(root, 'packages', 'db', 'migrations'),
  [PACKAGED_RESOURCES.assets]: join(desktopDir, 'assets'),
};
const extraResource = Object.entries(resources).map(([name, from]) => {
  const to = join(stage, 'resources', name);
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      // プロンプトの評価用のサンプルと出力は、アプリでは使わない
      if (name === PACKAGED_RESOURCES.prompts) return !src.startsWith(join(from, 'eval'));
      // サーバーには、メインプロセスの入口を入れない
      if (name === PACKAGED_RESOURCES.server) return !isMainEntry(src);
      return true;
    },
  });
  return to;
});

const platformArch =
  process.env.MYMIND_PACKAGE_ARCH ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
const [appPath] = await packager({
  dir: stageApp,
  out: join(desktopDir, 'out'),
  overwrite: true,
  platform: 'darwin',
  // CI（Linux）でも中身を確かめられるよう、mac 用の .app を作る。arch は MYMIND_PACKAGE_ARCH で変えられる
  arch: platformArch,
  name: 'mymind',
  electronVersion,
  appBundleId: APP_BUNDLE_ID,
  appVersion,
  buildVersion: `${appVersion}+${commit}`,
  appCategoryType: 'public.app-category.productivity',
  icon: join(desktopDir, 'assets', 'icon.icns'),
  extraResource,
  // 自分用なので asar にまとめず、成果物をそのまま置く（中身を確かめやすく、子プロセスのサーバーも普通のファイルとして読める）
  asar: false,
  prune: false,
  // Electron の本体のキャッシュ。electron_config_cache があれば使う（Claude Code のサンドボックスではホームの下に書けないため）
  ...(process.env.electron_config_cache === undefined
    ? {}
    : { download: { cacheRoot: process.env.electron_config_cache } }),
});
process.stdout.write(`mymind.app を作りました: ${join(appPath, 'mymind.app')}\n`);
