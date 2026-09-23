// CI で PR の約束事を確認する（.github/workflows/pr-policy.yml から実行）。
// - タイトルが Conventional Commits の形式か
// - 本文が issue を参照しているか
// - レビュー必須の変更を含む場合、review:required ラベルを付ける
import { execFileSync } from 'node:child_process';
import { ISSUE_REF_PATTERN, reviewRequiredFiles, TITLE_PATTERN } from './review-policy.mjs';

const pr = process.env['PR_NUMBER'];
if (!pr) {
  console.error('PR_NUMBER が設定されていません');
  process.exit(1);
}
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const info = JSON.parse(gh(['pr', 'view', pr, '--json', 'title,body,files,labels,author']));
const isBot = info.author?.is_bot === true;

const errors = [];
if (!TITLE_PATTERN.test(info.title)) {
  errors.push(`タイトルが Conventional Commits の形式ではありません: "${info.title}"`);
}
// Dependabot などのボットの PR は issue の参照を求めない
if (!isBot && !ISSUE_REF_PATTERN.test(info.body ?? '')) {
  errors.push('本文に issue の参照（例：Closes #12）がありません');
}

const matched = reviewRequiredFiles(info.files.map((f) => f.path));
const hasLabel = info.labels.some((l) => l.name === 'review:required');
if (matched.length > 0 && !hasLabel) {
  gh(['pr', 'edit', pr, '--add-label', 'review:required']);
  console.log(`review:required を付けました:\n${matched.map((p) => `  - ${p}`).join('\n')}`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('PR の約束事を満たしています');
