// Codex に差分のレビューを依頼する（ADR-0013）。PR を作る前に実行する。
// 使い方: node scripts/codex-review.mjs [ベースブランチ（既定: origin/main）]
// 結果は標準出力と .data/reviews/<ブランチ名>.md に書く。
// 終了コード: 0=レビューした / 4=サンドボックスの中で実行された / 5=Codex を使えない（未インストール・未ログイン・通信エラーなど）
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'origin/main';
const root = new URL('..', import.meta.url).pathname;

const PROMPT = `このリポジトリの AGENTS.md と .claude/rules/ のルールに照らして、差分をレビューしてください。
正しさの誤り、要件（docs/requirements.md）との食い違い、テストの不足、ルール違反を優先し、書き方の好みは挙げないでください。
指摘は日本語で、1件ごとに「ファイルと行」「重要度（高・中・低）」「理由」「直し方の案」を書いてください。
指摘がなければ「指摘なし」とだけ書いてください。`;

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  encoding: 'utf8',
}).trim();

let output;
try {
  output = execFileSync(
    'codex',
    // レビューでは Codex にファイルを書き換えさせない
    ['review', '--base', base, '-c', 'sandbox_mode="read-only"', PROMPT],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    },
  ).trim();
} catch (error) {
  const detail = String(error.stderr ?? error.message ?? '').trim();
  // Claude Code のサンドボックスは ~/.codex の読み取りを禁止している。
  // コマンド全体が除外済みのコマンドだけでできていないと、中で実行されてここへ来る
  if (detail.includes('Operation not permitted') || detail.includes('operation not permitted')) {
    console.error(
      'Codex が認証情報を読めません（サンドボックスの中で実行されています）。\n' +
        '`node scripts/codex-review.mjs` を、パイプ・リダイレクト・`;`・`&&` を付けずに単独で実行してください。',
    );
    process.exit(4);
  }
  // 使えないときは止めずに、PR に「未実施」と理由を書いて進める（ADR-0013）
  console.error(
    `Codex のレビューを実行できませんでした。PR に未実施と理由を書いてください。\n${detail}`,
  );
  process.exit(5);
}

const dir = join(root, '.data', 'reviews');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${branch.replaceAll('/', '-')}.md`);
writeFileSync(file, `# Codex レビュー（${branch}、ベース ${base}）\n\n${output}\n`);
console.log(output);
console.error(`\n保存しました: ${file}`);
