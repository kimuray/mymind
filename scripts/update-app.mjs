// 手元の mymind を新しいバージョンにする（#33）。手順は docs/operations.md。
// 使い方: pnpm update-app（main を最新にし、依存を入れ、画面をビルドする）
// DB のマイグレーションは、次にサーバーを起動したときに、自動でスナップショットを取ってから適用される。
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => {
  console.error(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
};

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (branch !== 'main') {
  console.error(`main 以外のブランチ（${branch}）にいます。main に切り替えてから実行してください`);
  process.exit(1);
}
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty !== '') {
  console.error('コミットしていない変更があります。片付けてから実行してください');
  process.exit(1);
}

run('git', ['pull', '--ff-only']);
run('pnpm', ['install', '--frozen-lockfile']);
run('pnpm', ['build']);
console.error('\n更新しました。サーバーを再起動してください（常駐の設定は #12 で用意する）。');
console.error(
  '起動時に未適用のマイグレーションがあれば、先に backups/ へスナップショットを取ってから適用します。',
);
