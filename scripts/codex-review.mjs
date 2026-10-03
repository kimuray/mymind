// Codex に差分のレビューを依頼する（ADR-0013）。PR を作る前に1回だけ実行する。
// 使い方: node scripts/codex-review.mjs [ベースブランチ（既定: origin/main）]
// 観点（正しさ・セキュリティ・非機能）は codex-review.prompt.md、出力の形は codex-review.schema.json にある。
// 結果は標準出力と .data/reviews/<ブランチ名>.md（と .json）に書く。
// 終了コード: 0=指摘なし / 1=指摘あり / 4=サンドボックスの中で実行された / 5=Codex を使えない（未インストール・未ログイン・通信エラーなど）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'origin/main';
// URL の pathname はスペースや日本語を %20 などのまま返すので、ファイルのパスに変換して使う
const root = fileURLToPath(new URL('..', import.meta.url));
const here = join(root, 'scripts');

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const dir = join(root, '.data', 'reviews');
mkdirSync(dir, { recursive: true });
const name = branch.replaceAll('/', '-');
const jsonFile = join(dir, `${name}.json`);
const mdFile = join(dir, `${name}.md`);

const unavailable = (detail) => {
  // 使えないときは止めずに、PR に「未実施」と理由を書いて進める（ADR-0013）
  console.error(
    `Codex のレビューを実行できませんでした。PR に未実施と理由を書いてください。\n${detail}`,
  );
  process.exit(5);
};

const prompt = readFileSync(join(here, 'codex-review.prompt.md'), 'utf8').replaceAll(
  '{{base}}',
  base,
);
try {
  execFileSync(
    'codex',
    [
      'exec',
      // レビューではファイルを書き換えさせない
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--cd',
      root,
      '--output-schema',
      join(here, 'codex-review.schema.json'),
      '--output-last-message',
      jsonFile,
      prompt,
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    },
  );
} catch (error) {
  const detail = String(error.stderr ?? error.message ?? '').trim();
  // Claude Code のサンドボックスは ~/.codex の読み取りを禁止している。
  // コマンド全体が除外済みのコマンドだけでできていないと、中で実行されてここへ来る
  if (/operation not permitted/i.test(detail)) {
    console.error(
      'Codex が認証情報を読めません（サンドボックスの中で実行されています）。\n' +
        '`node scripts/codex-review.mjs` を、パイプ・リダイレクト・`;`・`&&` を付けずに単独で実行してください。',
    );
    process.exit(4);
  }
  unavailable(detail.split('\n').slice(-20).join('\n'));
}

let review;
try {
  review = JSON.parse(readFileSync(jsonFile, 'utf8'));
} catch (error) {
  unavailable(`出力を JSON として読めませんでした: ${error.message}`);
}
const CATEGORY = { correctness: '正しさ', security: 'セキュリティ', nonfunctional: '非機能' };
const SEVERITY = { high: '高', medium: '中', low: '低' };

// エージェントの出力なので、Codex 側のスキーマ指定に頼らずここでも確かめる。
// ルートのスクリプトは zod に依存していないため、codex-review.schema.json と同じ条件を手で書く
const isNullable = (v, type) => v === null || typeof v === type;
const isFinding = (f) =>
  typeof f === 'object' &&
  f !== null &&
  Object.hasOwn(CATEGORY, f.category) &&
  Object.hasOwn(SEVERITY, f.severity) &&
  typeof f.file === 'string' &&
  (f.line === null || Number.isInteger(f.line)) &&
  typeof f.title === 'string' &&
  typeof f.reason === 'string' &&
  typeof f.suggestion === 'string' &&
  isNullable(f.requirement, 'string');
if (
  typeof review?.summary !== 'string' ||
  !Array.isArray(review.findings) ||
  !review.findings.every(isFinding)
) {
  unavailable(`出力がスキーマの形になっていません: ${jsonFile}`);
}

const ORDER = { high: 0, medium: 1, low: 2 };
const findings = [...review.findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

const lines = [`# Codex レビュー（${branch}、ベース ${base}）`, '', review.summary, ''];
if (findings.length === 0) {
  lines.push('指摘なし');
} else {
  lines.push(`## 指摘（${findings.length}件）`, '');
  findings.forEach((f, i) => {
    const place = f.line === null ? f.file : `${f.file}:${f.line}`;
    lines.push(
      `### ${i + 1}. [${SEVERITY[f.severity]}][${CATEGORY[f.category]}] ${f.title}`,
      '',
      `- 場所：${place}${f.requirement ? `（${f.requirement}）` : ''}`,
      `- 理由：${f.reason}`,
      `- 直し方：${f.suggestion}`,
      '',
    );
  });
}
const markdown = `${lines.join('\n').trim()}\n`;
writeFileSync(mdFile, markdown);
console.log(markdown);
console.error(`保存しました: ${mdFile}`);
process.exit(findings.length === 0 ? 0 : 1);
