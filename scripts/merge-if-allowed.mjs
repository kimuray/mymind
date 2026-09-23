// PR をマージしてよいかを機械的に判定し、許可される場合だけマージする（.claude/rules/autonomy.md、issue 023）。
// 使い方: node scripts/merge-if-allowed.mjs <PR番号>
// 終了コード: 0=マージした / 2=レビュー必須 / 3=条件未達（CI、draft、ベースブランチなど）
import { execFileSync } from 'node:child_process';
import { reviewRequiredFiles } from './review-policy.mjs';

const pr = process.argv[2];
if (!pr || !/^\d+$/.test(pr)) {
  console.error('使い方: node scripts/merge-if-allowed.mjs <PR番号>');
  process.exit(3);
}
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const info = JSON.parse(
  gh([
    'pr',
    'view',
    pr,
    '--json',
    'state,isDraft,baseRefName,labels,files,statusCheckRollup,mergeable',
  ]),
);

const stop = (code, message) => {
  console.error(message);
  process.exit(code);
};

if (info.state !== 'OPEN') stop(3, `PR #${pr} は開いていません（${info.state}）`);
if (info.isDraft) stop(3, `PR #${pr} は draft です`);
if (info.baseRefName !== 'main')
  stop(
    3,
    `PR #${pr} のベースが main ではありません（${info.baseRefName}）。土台の PR のマージを待ってください`,
  );

const labels = info.labels.map((l) => l.name);
const matched = reviewRequiredFiles(info.files.map((f) => f.path));
if (matched.length > 0 || labels.includes('review:required')) {
  if (!labels.includes('review:required')) gh(['pr', 'edit', pr, '--add-label', 'review:required']);
  stop(
    2,
    `PR #${pr} はレビュー必須です。対象のファイル:\n${matched.map((p) => `  - ${p}`).join('\n') || '  （ラベルによる指定）'}`,
  );
}

const checks = info.statusCheckRollup ?? [];
if (checks.length === 0) stop(3, `PR #${pr} に CI の結果がありません`);
// スキップされたジョブや中立の結果は失敗として扱わない
const OK = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
const failing = checks.filter((c) => !OK.has(c.conclusion ?? c.state));
if (failing.length > 0) {
  stop(
    3,
    `PR #${pr} の CI が完了していないか、失敗しています: ${failing.map((c) => c.name ?? c.context).join(', ')}`,
  );
}
if (info.mergeable !== 'MERGEABLE')
  stop(3, `PR #${pr} はマージできない状態です（${info.mergeable}）`);

gh(['pr', 'merge', pr, '--squash', '--delete-branch']);
console.log(`PR #${pr} をマージしました`);
