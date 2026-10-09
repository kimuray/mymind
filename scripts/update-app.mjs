// 手元の mymind を新しいバージョンにする（#33、NFR-25）。手順は docs/operations.md。
// 使い方: pnpm update-app [--force] [--no-app]
//   main を最新にし、依存を入れ、ビルドする。/Applications/mymind.app が入っていれば、作り直して入れ替え、
//   動いていたら終了させてから入れ替えて開き直す。入っている .app が今のコミットから作られていれば作り直さない（--force で作り直す）
//   アプリの「再起動して更新」も、このスクリプトを実行する（FR-U05）
// DB のマイグレーションは、次にサーバーを起動したときに、自動でスナップショットを取ってから適用される。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_BUNDLE_ID,
  appProcessPattern,
  DEFAULT_APP_PATH,
  parseUpdateAppArgs,
  planAppUpdate,
} from '../apps/desktop/src/appInstall.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

const run = (cmd, args) => {
  console.error(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root });
};
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: root }).trim();

const parsed = parseUpdateAppArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}
const options = parsed.value;

const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  console.error(`main 以外のブランチ（${branch}）にいます。main に切り替えてから実行してください`);
  process.exit(1);
}
if (read('git', ['status', '--porcelain']) !== '') {
  console.error('コミットしていない変更があります。片付けてから実行してください');
  process.exit(1);
}

run('git', ['pull', '--ff-only']);
run('pnpm', ['install', '--frozen-lockfile']);
run('pnpm', ['build']);

const appPath = process.env.MYMIND_APP_PATH ?? DEFAULT_APP_PATH;
const plan = planAppUpdate({
  options,
  installedBundleVersion: readBundleVersion(appPath),
  headCommit: read('git', ['rev-parse', 'HEAD']),
});
if (plan.action === 'skip') {
  const why = {
    disabled: 'デスクトップアプリは入れ替えません（--no-app）。',
    'not-installed': `${appPath} が入っていないので、デスクトップアプリは入れ替えません（初めて入れるときは docs/operations.md の「デスクトップアプリを入れる」）。`,
    'up-to-date': `${appPath} は今のコミットから作られています（作り直すときは --force）。`,
  }[plan.reason];
  console.error(`\n${why}`);
  console.error(
    'ブラウザ版を使っている場合は、サーバーを再起動してください。未適用のマイグレーションがあれば、先に backups/ へスナップショットを取ってから適用します。',
  );
  process.exit(0);
}

run('pnpm', ['--filter', '@mymind/desktop', 'package']);
const arch = process.env.MYMIND_PACKAGE_ARCH ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
const builtApp = join(root, 'apps', 'desktop', 'out', `mymind-darwin-${arch}`, 'mymind.app');
if (!existsSync(builtApp)) {
  console.error(`作った mymind.app が見つかりません: ${builtApp}`);
  process.exit(1);
}

const wasRunning = isAppRunning(appPath);
if (wasRunning) quitApp(appPath);
try {
  replaceApp(builtApp, appPath);
} finally {
  // 入れ替えに失敗しても、元の .app に戻してあるので、動いていたなら開き直す
  if (wasRunning) {
    console.error(`$ open ${appPath}`);
    spawnSync('open', [appPath], { stdio: 'inherit' });
  }
}
console.error(`\n${appPath} を新しいバージョンにしました。`);
console.error(
  '起動時に未適用のマイグレーションがあれば、先に backups/ へスナップショットを取ってから適用します。',
);

/** 入っている .app の CFBundleVersion。入っていなければ null */
function readBundleVersion(path) {
  const plist = join(path, 'Contents', 'Info.plist');
  if (!existsSync(plist)) return null;
  const result = spawnSync('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist], {
    encoding: 'utf8',
  });
  // 読めない .app は「作ったコミットが分からない」として入れ替える
  return result.status === 0 ? result.stdout.trim() : '';
}

function isAppRunning(path) {
  return spawnSync('pgrep', ['-f', appProcessPattern(path)]).status === 0;
}

/**
 * 動いているアプリを終了させ、サーバーも止まるまで待つ。メニューの「mymind を終了」と同じく、
 * Apple Event の quit で終わらせる（サーバーを止めてから終わる）。送れないときは SIGTERM を送る
 */
function quitApp(path) {
  console.error('mymind を終了します');
  const quit = spawnSync('osascript', ['-e', `tell application id "${APP_BUNDLE_ID}" to quit`], {
    stdio: 'inherit',
  });
  if (quit.status !== 0) spawnSync('pkill', ['-TERM', '-f', appProcessPattern(path)]);
  const deadline = Date.now() + 30_000;
  while (isAppRunning(path)) {
    if (Date.now() > deadline) {
      console.error(
        'mymind が30秒たっても終了しません。メニューバーのマメから終了してから、もう一度実行してください',
      );
      process.exit(1);
    }
    spawnSync('sleep', ['0.5']);
  }
}

/** 古い .app を脇に退けてから新しい .app を写す。写せなければ古い .app に戻す */
function replaceApp(from, to) {
  const previous = `${to}.previous`;
  rmSync(previous, { recursive: true, force: true });
  renameSync(to, previous);
  try {
    // ditto は .app の属性やシンボリックリンクを保ったまま写す
    run('ditto', [from, to]);
  } catch (e) {
    rmSync(to, { recursive: true, force: true });
    renameSync(previous, to);
    throw e;
  }
  rmSync(previous, { recursive: true, force: true });
}
