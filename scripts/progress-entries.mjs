// 作業記録（docs/progress/*.md）を読み、表にする。scripts/progress.mjs と scripts/docs-build.mjs で使う。
// 1件を1ファイルにしているのは、並行する PR が同じ表の末尾に追記してコンフリクトするのを避けるため。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROGRESS_DIR = 'docs/progress';
// <日付>-<その日の順番>-<issue番号または短い名前>.md
export const ENTRY_NAME = /^(\d{4}-\d{2}-\d{2})-(\d{2})-[a-z0-9-]+\.md$/;
const FIELDS = ['date', 'issue', 'pr', 'result', 'next'];

function parseEntry(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const value = kv[2].trim();
    fields[kv[1]] = /^".*"$/.test(value) ? value.slice(1, -1).replaceAll('\\"', '"') : value;
  }
  return fields;
}

// 記録を古い順に返す。形式の誤りは problems に入れる（docs:check で落とすため）
export function readProgressEntries(root) {
  const dir = join(root, PROGRESS_DIR);
  const entries = [];
  const problems = [];
  if (!existsSync(dir)) return { entries, problems };
  for (const file of readdirSync(dir).sort()) {
    if (file === 'README.md' || !file.endsWith('.md')) continue;
    const src = `${PROGRESS_DIR}/${file}`;
    const name = file.match(ENTRY_NAME);
    if (!name) {
      problems.push(
        `${src}: ファイル名は <日付>-<2桁の順番>-<issue番号または名前>.md にしてください`,
      );
      continue;
    }
    const fields = parseEntry(readFileSync(join(dir, file), 'utf8'));
    const missing = FIELDS.filter((f) => !fields?.[f]);
    if (missing.length > 0) {
      problems.push(`${src}: 先頭の --- の間に ${missing.join('、')} がありません`);
      continue;
    }
    if (fields.date !== name[1]) {
      problems.push(`${src}: date（${fields.date}）がファイル名の日付と違います`);
      continue;
    }
    entries.push({ src, ...fields });
  }
  return { entries, problems };
}

const cell = (s) => s.replaceAll('|', '\\|');

// Markdown の表にする。entries は並べたい順に渡す
export function renderProgressTable(entries) {
  const head = '| 日付 | issue | PR | 結果 | 次の予定・メモ |\n|---|---|---|---|---|';
  const rows = entries.map(
    (e) => `| ${e.date} | ${cell(e.issue)} | ${cell(e.pr)} | ${cell(e.result)} | ${cell(e.next)} |`,
  );
  return [head, ...rows].join('\n');
}
