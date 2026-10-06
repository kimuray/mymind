// pnpm desktop:package で作った mymind.app の中身を確かめる（#211、NFR-25）。CI でも .app を作ってから実行する。
// 1. Resources に、起動したアプリが探す成果物がそろっていて、入れないもの（評価用のプロンプト、重複した入口）がないこと
// 2. Info.plist の名前、版、アイコン
// 3. .app の中の成果物だけで、サーバーが起動して API と画面を返すこと（Electron は起動しない。Node.js で束ねたサーバーを動かす）
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGED_RESOURCES, SERVER_ENTRY } from '../src/packageLayout.ts';

const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const out = join(desktopDir, 'out');
const built = existsSync(out) ? readdirSync(out).filter((d) => d.startsWith('mymind-darwin-')) : [];
if (built.length !== 1) {
  console.error(
    `mymind.app が1つ見つかりません（${out}）。先に pnpm desktop:package を実行してください`,
  );
  process.exit(1);
}
const contents = join(out, built[0] ?? '', 'mymind.app', 'Contents');
const resources = join(contents, 'Resources');
const at = (...parts) => join(resources, ...parts);

const problems = [];
const expectFile = (path, why) => {
  if (!existsSync(path)) problems.push(`ない：${path}（${why}）`);
};
const expectNoFile = (path, why) => {
  if (existsSync(path)) problems.push(`入れないはずのものがある：${path}（${why}）`);
};

// 1. 成果物
expectFile(at('app', 'package.json'), 'メインプロセスの package.json');
expectFile(at('app', 'dist', 'main.mjs'), 'メインプロセス');
expectFile(at('app', 'dist', 'preload.cjs'), 'preload');
expectNoFile(at('app', 'dist', SERVER_ENTRY), 'サーバーは Resources/server に分ける');
expectFile(at(PACKAGED_RESOURCES.server, SERVER_ENTRY), '束ねたサーバー');
expectNoFile(at(PACKAGED_RESOURCES.server, 'main.mjs'), 'サーバーにメインプロセスは入れない');
expectFile(at(PACKAGED_RESOURCES.web, 'index.html'), '画面のビルド');
for (const file of ['daily-feedback.md', 'monthly-summary.md', 'coaching-policy.md']) {
  expectFile(at(PACKAGED_RESOURCES.prompts, file), 'プロンプトと方針');
}
expectNoFile(at(PACKAGED_RESOURCES.prompts, 'eval'), '評価用のサンプルと出力は入れない');
const migrations = at(PACKAGED_RESOURCES.migrations);
if (!existsSync(migrations) || readdirSync(migrations).length === 0) {
  problems.push(`マイグレーションがない：${migrations}`);
}
for (const file of ['trayTemplate.png', 'trayTemplate@2x.png', 'icon.png']) {
  expectFile(at(PACKAGED_RESOURCES.assets, file), 'アイコン');
}
const appPackage = existsSync(at('app', 'package.json'))
  ? JSON.parse(readFileSync(at('app', 'package.json'), 'utf8'))
  : {};
if (appPackage.main !== 'dist/main.mjs')
  problems.push(`package.json の main が dist/main.mjs でない：${appPackage.main}`);

// 2. Info.plist（XML から、キーの次の文字列を読む）
const plist = readFileSync(join(contents, 'Info.plist'), 'utf8');
const plistValue = (key) =>
  plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1] ?? null;
if (plistValue('CFBundleName') !== 'mymind')
  problems.push(`CFBundleName が mymind でない：${plistValue('CFBundleName')}`);
if (plistValue('CFBundleIdentifier') !== 'local.mymind.desktop') {
  problems.push(`CFBundleIdentifier が違う：${plistValue('CFBundleIdentifier')}`);
}
if (!/\+[0-9a-f]+$|\+unknown$/.test(plistValue('CFBundleVersion') ?? '')) {
  problems.push(`CFBundleVersion に作ったコミットがない：${plistValue('CFBundleVersion')}`);
}
const icon = plistValue('CFBundleIconFile');
if (
  icon === null ||
  !readFileSync(at(icon)).equals(readFileSync(join(desktopDir, 'assets', 'icon.icns')))
) {
  problems.push('アプリのアイコンが icon.icns でない');
}

if (problems.length > 0) {
  console.error(`mymind.app の中身に問題があります：\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// 3. .app の中の成果物だけでサーバーを動かす（関係のないディレクトリから起動し、成果物の場所は環境変数で渡す）
const dataDir = mkdtempSync(join(tmpdir(), 'mymind-package-'));
const port = process.env.MYMIND_CHECK_PORT ?? '4861';
const server = spawn(process.execPath, [at(PACKAGED_RESOURCES.server, SERVER_ENTRY)], {
  cwd: tmpdir(),
  env: {
    ...process.env,
    MYMIND_DATA_DIR: dataDir,
    MYMIND_PORT: port,
    MYMIND_AGENT: 'fake',
    MYMIND_WEB_DIST: at(PACKAGED_RESOURCES.web),
    MYMIND_PROMPTS_DIR: at(PACKAGED_RESOURCES.prompts),
    MYMIND_MIGRATIONS_DIR: migrations,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const failures = [];
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('20秒以内に起動しませんでした')), 20_000);
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('起動しました')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', (code) => reject(new Error(`サーバーが終了しました（終了コード ${code}）`)));
  });
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  if (health.status !== 200) failures.push(`/api/health が ${health.status}`);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  if (page.status !== 200 || !html.includes('<div id="root">'))
    failures.push(`画面が返らない（${page.status}）`);
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error(
    `mymind.app の中の成果物でサーバーを動かせませんでした：\n  ${failures.join('\n  ')}`,
  );
  process.exit(1);
}
process.stdout.write(
  `mymind.app の中身を確かめました（${plistValue('CFBundleShortVersionString')}、${plistValue('CFBundleVersion')}）\n`,
);
