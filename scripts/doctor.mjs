// 開発環境の前提を確認する。エージェントは作業の開始・再開時に実行する（.claude/rules/autonomy.md）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const results = [];
const check = (level, name, fn) => {
  try {
    const detail = fn();
    results.push({ ok: true, level, name, detail: detail ?? '' });
  } catch (e) {
    results.push({
      ok: false,
      level,
      name,
      detail: (e instanceof Error ? e.message : String(e)).split('\n')[0],
    });
  }
};
const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

check('必須', 'Node.js 24 以上', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) throw new Error(`現在 ${process.versions.node}`);
  return process.versions.node;
});
check('必須', 'pnpm', () => run('pnpm', ['--version']));
check('必須', '依存関係のインストール', () => {
  if (!existsSync(join(root, 'node_modules'))) throw new Error('pnpm install を実行してください');
});
check('必須', 'Git リポジトリ', () => run('git', ['rev-parse', '--abbrev-ref', 'HEAD']));
check('必須', '実データのディレクトリを使っていない', () => {
  const dir = process.env['MYMIND_DATA_DIR'];
  if (dir && resolve(dir).startsWith(join(homedir(), '.mymind'))) {
    throw new Error('開発・テストでは MYMIND_DATA_DIR=./.data を使ってください');
  }
  mkdirSync(join(root, '.data'), { recursive: true });
  return dir ?? '（未設定：./.data を使用）';
});
check('推奨', 'GitHub CLI の認証', () => {
  run('gh', ['auth', 'status']);
  return '認証済み';
});
check('推奨', 'Git のリモート', () => run('git', ['remote', 'get-url', 'origin']));
check('推奨', 'Playwright のブラウザ', () => {
  const dirs = [
    join(homedir(), 'Library/Caches/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
  ];
  if (!dirs.some(existsSync))
    throw new Error('pnpm exec playwright install chromium を実行してください');
});
check('任意', 'Docker Compose（コンテナで開発する場合）', () =>
  run('docker', ['compose', 'version', '--short']),
);
for (const cli of ['claude', 'codex']) {
  check('任意', `${cli} コマンド（FB の実機確認用）`, () => run('which', [cli]));
}

let failed = false;
for (const r of results) {
  const mark = r.ok ? '✔' : r.level === '必須' ? '✖' : '△';
  if (!r.ok && r.level === '必須') failed = true;
  console.log(`${mark} [${r.level}] ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
}
if (failed) {
  console.error('\n必須の項目が満たされていません。解決してから作業を始めてください。');
  process.exit(1);
}
