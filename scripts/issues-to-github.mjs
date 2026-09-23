// docs/issues/*.md を GitHub の issue として登録する。
// 使い方: node scripts/issues-to-github.mjs [--dry-run]
// 1回目の走査で issue を作成し、2回目の走査で本文中の「issue 001」を「#12」のような GitHub の番号に置き換える。
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const dir = new URL('../docs/issues/', import.meta.url).pathname;
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();

const LABEL_COLORS = {
  type: '5319e7',
  priority: 'b60205',
  area: '1d76db',
  status: '0e8a16',
  review: 'b60205',
};

function parse(file) {
  const raw = readFileSync(join(dir, file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: frontmatter がありません`);
  const [, head, body] = m;
  const get = (key) => head.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? '';
  const title = get('title').replace(/^"|"$/g, '');
  const labels = get('labels')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    local: file.replace('.md', ''),
    title,
    labels,
    milestone: get('milestone'),
    body: body.trim(),
  };
}

const issues = readdirSync(dir)
  .filter((f) => /^\d{3}\.md$/.test(f))
  .sort()
  .map(parse);

if (dryRun) {
  for (const i of issues)
    console.log(`[${i.local}] ${i.title}  (${i.labels.join(', ')} / ${i.milestone})`);
  process.exit(0);
}

// ラベルとマイルストーンを用意する
const labels = new Set(issues.flatMap((i) => i.labels));
for (const label of labels) {
  const color = LABEL_COLORS[label.split(':')[0]] ?? 'ededed';
  gh(['label', 'create', label, '--color', color, '--force']);
}
const existing = JSON.parse(gh(['api', 'repos/{owner}/{repo}/milestones?state=all&per_page=100']));
for (const ms of new Set(issues.map((i) => i.milestone).filter(Boolean))) {
  if (!existing.some((e) => e.title === ms)) {
    gh(['api', 'repos/{owner}/{repo}/milestones', '-f', `title=${ms}`]);
  }
}

// 1回目：作成
const map = {};
for (const i of issues) {
  const args = [
    'issue',
    'create',
    '--title',
    i.title,
    '--body',
    `${i.body}\n\n---\nローカル番号: ${i.local}`,
  ];
  for (const l of i.labels) args.push('--label', l);
  if (i.milestone) args.push('--milestone', i.milestone);
  const url = gh(args);
  map[i.local] = url.split('/').pop();
  console.log(`${i.local} -> #${map[i.local]}`);
}

// 2回目：本文中の「issue 001」を GitHub の番号に置き換える
for (const i of issues) {
  const replaced = i.body.replace(/issue (\d{3})/g, (all, n) => (map[n] ? `#${map[n]}` : all));
  if (replaced !== i.body) {
    gh(['issue', 'edit', map[i.local], '--body', `${replaced}\n\n---\nローカル番号: ${i.local}`]);
  }
}

writeFileSync(join(dir, 'github-map.json'), `${JSON.stringify(map, null, 2)}\n`);
console.log('対応表を docs/issues/github-map.json に保存しました');
