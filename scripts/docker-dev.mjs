// Docker の開発サーバー（compose の dev、ADR-0010）。pnpm install と pnpm dev を包み、次を行う（#97）。
// - 起動時と再起動時に、動かしているブランチとコミットを表示する（コンテナは作業ツリーをそのままマウントするので、
//   そこで別のブランチに切り替えると、その内容で動く）
// - pnpm-lock.yaml の中身が変わったら（ブランチの切り替えや git pull）、pnpm install をやり直して開発サーバーを再起動する。
//   node_modules は名前付きボリュームなので、入れ直さないと新しい依存関係が見つからず、画面が更新されない
// ソースのバインドマウントでは変更の通知が届かないことがあるので、lockfile はポーリングで見る。
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const lockfile = join(root, 'pnpm-lock.yaml');
const POLL_MS = 2000;
// ブランチを切り替えている途中の中間の状態で入れ直さないよう、変更が落ち着いてから入れ直す
const SETTLE_MS = 3000;

const log = (message) => process.stdout.write(`[docker-dev] ${message}\n`);

const lockHash = () => {
  try {
    return createHash('sha256').update(readFileSync(lockfile)).digest('hex');
  } catch (e) {
    // ブランチの切り替えの途中で一瞬なくなることがある。次のポーリングで読み直す
    log(`pnpm-lock.yaml を読めませんでした（${e instanceof Error ? e.message : String(e)}）`);
    return null;
  }
};

/** 動かしているソースのブランチとコミット。git が使えなければ「不明」と出す */
function describeSource() {
  const git = (...args) =>
    execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
      cwd: root,
      encoding: 'utf8',
      // git worktree のチェックアウトでは、.git がコンテナの外のパスを指すので失敗する。その理由は下で1行にまとめて出す
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  try {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const commit = git('log', '-1', '--format=%h %s');
    const dirty = git('status', '--porcelain').length > 0 ? '（コミットしていない変更あり）' : '';
    return `${branch} / ${commit}${dirty}`;
  } catch (e) {
    return `不明（${e instanceof Error ? e.message.split('\n')[0] : String(e)}）`;
  }
}

/** lockfile のとおりに入れる。lockfile と package.json が合わないときは入れずに知らせる（lockfile を書き換えない） */
function install() {
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    log(
      'pnpm install に失敗しました。lockfile と package.json が合っていない可能性があります。' +
        'ホストで pnpm install を実行して lockfile を更新すると、自動で入れ直します',
    );
  }
}

let dev = null;
let stopping = false;

function startDev() {
  log(`ソース：${describeSource()}`);
  // プロセスグループごと止められるよう、別のグループで起動する（pnpm -r --parallel の子まで止めるため）
  dev = spawn('pnpm', ['dev'], { cwd: root, stdio: 'inherit', detached: true });
  dev.on('exit', (code, signal) => {
    if (!stopping) log(`開発サーバーが終了しました（${signal ?? code}）`);
  });
}

/** 開発サーバーをグループごと止め、終わるまで待つ。サーバーが終了時にロックファイルを消せるよう、まず SIGTERM を送る */
function stopDev() {
  const child = dev;
  dev = null;
  if (child === null || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // 既に終わっている
      }
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      clearTimeout(force);
      resolve();
    }
  });
}

let installedHash = lockHash();
install();
startDev();

let timer = null;
let restarting = false;
watchFile(lockfile, { interval: POLL_MS }, () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const hash = lockHash();
    if (hash === null || hash === installedHash || restarting) return;
    restarting = true;
    log('pnpm-lock.yaml が変わりました。依存関係を入れ直して、開発サーバーを再起動します');
    stopping = true;
    await stopDev();
    stopping = false;
    installedHash = hash;
    install();
    startDev();
    restarting = false;
  }, SETTLE_MS);
});

// docker compose stop / Ctrl+C（tini が転送する）で、開発サーバーまで止めてから終わる
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    stopping = true;
    unwatchFile(lockfile);
    clearTimeout(timer);
    await stopDev();
    process.exit(0);
  });
}
