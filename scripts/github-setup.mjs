// GitHub リポジトリの初期設定（ラベル、マイルストーン、main の保護）。issue 029 で人が実行する。
import { execFileSync } from 'node:child_process';

const gh = (args, input) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  }).trim();

const labels = {
  'status:ready': ['0e8a16', '着手できる'],
  'status:blocked': ['fbca04', '依存する issue の完了待ち'],
  'status:needs-decision': ['d93f0b', '人の判断待ち'],
  'status:needs-human': ['d93f0b', '人の作業（アカウント・認証など）待ち'],
  'status:provisional': ['c5def5', '暫定決定で進行中。人のレビュー待ち'],
  'status:in-progress': ['1d76db', '作業中'],
  'review:required': ['b60205', '人のレビューが必須の PR'],
};
for (const [name, [color, description]] of Object.entries(labels)) {
  gh(['label', 'create', name, '--color', color, '--description', description, '--force']);
  console.log(`ラベル: ${name}`);
}

const existing = JSON.parse(gh(['api', 'repos/{owner}/{repo}/milestones?state=all&per_page=100']));
for (const ms of ['M1', 'M2', 'M3', 'M4', 'M5']) {
  if (!existing.some((e) => e.title === ms))
    gh(['api', 'repos/{owner}/{repo}/milestones', '-f', `title=${ms}`]);
  console.log(`マイルストーン: ${ms}`);
}

const protection = {
  required_status_checks: { strict: true, contexts: ['check', 'e2e', 'pr-policy'] },
  enforce_admins: false,
  required_pull_request_reviews: { required_approving_review_count: 0 },
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
};
try {
  gh(
    ['api', '-X', 'PUT', 'repos/{owner}/{repo}/branches/main/protection', '--input', '-'],
    JSON.stringify(protection),
  );
  console.log(
    'main ブランチを保護しました（PR 必須、check・e2e・pr-policy 必須、force push 禁止）',
  );
} catch (e) {
  console.warn(
    'main ブランチの保護を設定できませんでした。非公開リポジトリではプランによって使えない場合があります。',
  );
  console.warn(
    'その場合は .claude/settings.json の deny ルール（main への push 禁止）だけが守りになります。',
  );
  console.warn(e instanceof Error ? e.message : String(e));
}
