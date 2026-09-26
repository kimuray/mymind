// 設計まわりの Markdown を、人が読みやすい HTML に変換する（.claude/rules/workflow.md「設計文書の HTML」）。
// 正本は Markdown。HTML は生成物で、手で編集しない（docs-site/ は .gitignore 済み）。
//
// 使い方:
//   node scripts/docs-build.mjs          docs-site/ に HTML を出力する
//   node scripts/docs-build.mjs --check  出力せずに、リンク切れと存在しない要件ID・ADR・issue の参照を検査する
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, relative } from 'node:path';
import MarkdownIt from 'markdown-it';
import { PROGRESS_DIR, readProgressEntries, renderProgressTable } from './progress-entries.mjs';

const root = new URL('..', import.meta.url).pathname;
const outDir = join(root, 'docs-site');
const checkOnly = process.argv.includes('--check');

// ---------- 対象のファイル ----------
const SOURCES = [
  'docs/**/*.md',
  'DESIGN.md',
  'AGENTS.md',
  'prompts/*.md',
  '.claude/rules/*.md',
  '.claude/skills/**/*.md',
];
const EXCLUDE = [
  /^docs\/design\/mockup-source\/(?!README\.md$)/,
  // 作業記録は1件ずつのページにせず、docs/progress/README.md の表にまとめる
  /^docs\/progress\/(?!README\.md$)/,
];

function walk(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const rel = posix.join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
function collect() {
  const files = new Set();
  for (const pattern of SOURCES) {
    if (!pattern.includes('*')) {
      if (existsSync(join(root, pattern))) files.add(pattern);
      continue;
    }
    const base = pattern.split('/*')[0];
    const recursive = pattern.includes('**');
    for (const f of walk(base)) {
      if (!f.endsWith('.md')) continue;
      if (!recursive && posix.dirname(f) !== base) continue;
      files.add(f);
    }
  }
  return [...files].filter((f) => !EXCLUDE.some((re) => re.test(f))).sort();
}

const sources = collect();
const outPathOf = (src) => {
  // .claude/... は隠しディレクトリなので harness/ に置き換えて出力する
  const normalized = src.replace(/^\.claude\//, 'harness/');
  const dir = posix.dirname(normalized);
  const name = posix.basename(normalized);
  // .claude/skills/<name>/SKILL.md → harness/skills/<name>.html
  if (name === 'SKILL.md') {
    return posix.join(posix.dirname(dir), `${posix.basename(dir)}.html`);
  }
  return posix.join(
    dir === '.' ? '' : dir,
    name === 'README.md' ? 'index.html' : name.replace(/\.md$/, '.html'),
  );
};

// ---------- 参照の辞書（要件ID、ADR、issue） ----------
const requirementIds = new Set();
const reqSrc = 'docs/requirements.md';
if (existsSync(join(root, reqSrc))) {
  for (const m of readFileSync(join(root, reqSrc), 'utf8').matchAll(
    /^\|\s*((?:FR-[A-Z]\d{2})|(?:NFR-\d{2}))\s*\|/gm,
  )) {
    requirementIds.add(m[1]);
  }
}
const adrFiles = new Map();
for (const f of sources.filter((s) => /^docs\/adr\/\d{4}-/.test(s))) {
  adrFiles.set(posix.basename(f).slice(0, 4), f);
}
// issue は GitHub で管理する。文書に残る「issue 002」（GitHub 登録前の番号）は対応表で GitHub の番号に変える
const ISSUE_URL = 'https://github.com/kimuray/mymind/issues/';
const issueNumbers = new Map(
  Object.entries(JSON.parse(readFileSync(join(root, 'docs/issue-numbers.json'), 'utf8'))),
);

// ---------- Markdown の変換 ----------
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

function slugify(text, used) {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[\s　]+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]/gu, '') || 'section';
  let slug = base;
  let i = 2;
  while (used.has(slug)) slug = `${base}-${i++}`;
  used.add(slug);
  return slug;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: null, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"|"$/g, '');
  }
  return { meta, body: m[2] };
}

const problems = [];
const pages = [];

const progress = readProgressEntries(root);
problems.push(...progress.problems);

for (const src of sources) {
  const raw = readFileSync(join(root, src), 'utf8');
  const { meta, body: rawBody } = parseFrontmatter(raw);
  const body =
    src === `${PROGRESS_DIR}/README.md`
      ? `${rawBody}\n${renderProgressTable([...progress.entries].reverse())}\n`
      : rawBody;
  const env = { headings: [], used: new Set() };
  const tokens = md.parse(body, env);

  let title = meta?.title ?? '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const text = tokens[i + 1]?.content ?? '';
    const slug = slugify(text, env.used);
    t.attrSet('id', slug);
    if (t.tag === 'h1' && !title) title = text;
    if (t.tag === 'h2' || t.tag === 'h3') env.headings.push({ level: t.tag, text, slug });
  }
  if (!title) title = basename(src);

  // リンクの書き換えと検査
  const out = outPathOf(src);
  for (const t of tokens) {
    for (const child of t.children ?? []) {
      if (child.type !== 'link_open') continue;
      const href = child.attrGet('href') ?? '';
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const [pathPart, hash] = href.split('#');
      const target = posix.normalize(posix.join(posix.dirname(src), pathPart));
      let resolved = null;
      if (sources.includes(target)) resolved = target;
      else if (sources.includes(posix.join(target, 'README.md')))
        resolved = posix.join(target, 'README.md');
      if (!resolved) {
        problems.push(`${src}: リンク先が見つかりません → ${href}`);
        continue;
      }
      const rel =
        posix.relative(posix.dirname(out), outPathOf(resolved)) ||
        posix.basename(outPathOf(resolved));
      child.attrSet('href', hash ? `${rel}#${hash}` : rel);
    }
  }

  let html = md.renderer.render(tokens, md.options, env);
  html = decorate(html, src, out);
  pages.push({ src, out, title, meta, html, headings: env.headings });
}

// ---------- HTML の装飾（要件IDなどの自動リンク、色見本、表の行アンカー） ----------
function decorate(html, src, out) {
  const relTo = (targetSrc) =>
    posix.relative(posix.dirname(out), outPathOf(targetSrc)) ||
    posix.basename(outPathOf(targetSrc));

  // 要件の表の行にアンカーを付ける
  html = html.replace(
    /<tr>\s*<td>((?:FR-[A-Z]\d{2})|(?:NFR-\d{2}))<\/td>/g,
    '<tr id="$1"><td><strong>$1</strong></td>',
  );

  // 色見本：インラインコード内の 16進数の色と rgba()
  html = html.replace(
    /<code>(#[0-9a-fA-F]{3,8}|rgba?\([^<)]*\))<\/code>/g,
    (_all, c) => `<span class="swatch" style="--c:${c}"></span><code>${c}</code>`,
  );

  // テキスト部分だけを対象に、要件ID・ADR・issue を自動でリンクにする
  const parts = html.split(/(<[^>]+>)/);
  let skip = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('<')) {
      if (/^<(a|code|pre|h1)[\s>]/.test(p)) skip++;
      else if (/^<\/(a|code|pre|h1)>/.test(p)) skip = Math.max(0, skip - 1);
      continue;
    }
    if (skip > 0 || !p) continue;
    parts[i] = p
      .replace(/\b((?:FR-[A-Z]\d{2})|(?:NFR-\d{2}))\b/g, (id) => {
        if (!requirementIds.has(id)) {
          problems.push(`${src}: 存在しない要件ID → ${id}`);
          return id;
        }
        return src === reqSrc
          ? `<a href="#${id}">${id}</a>`
          : `<a class="ref" href="${relTo(reqSrc)}#${id}">${id}</a>`;
      })
      .replace(/ADR-(\d{4})/g, (all, n) => {
        const f = adrFiles.get(n);
        if (!f) {
          problems.push(`${src}: 存在しない ADR → ${all}`);
          return all;
        }
        return f === src ? all : `<a class="ref" href="${relTo(f)}">${all}</a>`;
      })
      .replace(/issue (\d{3})/g, (all, n) => {
        const number = issueNumbers.get(n);
        if (!number) {
          problems.push(`${src}: 存在しない issue → ${all}`);
          return all;
        }
        return `<a class="ref" href="${ISSUE_URL}${number}" title="#${number}">${all}</a>`;
      });
  }
  return parts.join('');
}

if (problems.length > 0) {
  console.error(`設計文書に ${problems.length} 件の問題があります:\n`);
  console.error([...new Set(problems)].join('\n'));
  process.exit(1);
}
if (checkOnly) {
  console.log(`設計文書 ${pages.length} ページを検査しました。問題はありません`);
  process.exit(0);
}

// ---------- ページの組み立て ----------
const NAV = [
  [
    '概要',
    [/^docs\/README\.md$/, /^AGENTS\.md$/, /^docs\/roadmap\.md$/, /^docs\/progress\/README\.md$/],
  ],
  [
    '要件と設計',
    [/^docs\/requirements\.md$/, /^docs\/architecture\.md$/, /^docs\/open-questions\.md$/],
  ],
  ['デザイン', [/^DESIGN\.md$/, /^docs\/design\//]],
  ['判断の記録（ADR）', [/^docs\/adr\//]],
  ['ルール（.claude/rules）', [/^\.claude\/rules\//]],
  ['スキル（.claude/skills）', [/^\.claude\/skills\//]],
  ['FB の方針とプロンプト', [/^prompts\//]],
];

function metaHtml(page) {
  const status = page.html.match(/<li>ステータス：([^<]+)<\/li>/);
  return status ? `<p class="meta"><span class="chip adr">${status[1]}</span></p>` : '';
}

function navHtml(page) {
  return NAV.map(([group, patterns]) => {
    const items = pages.filter((p) => patterns.some((re) => re.test(p.src)));
    if (items.length === 0) return '';
    const links = items
      .map((p) => {
        const href = posix.relative(posix.dirname(page.out), p.out) || posix.basename(p.out);
        const current = p === page ? ' aria-current="page"' : '';
        return `<li><a href="${href}"${current}>${escapeHtml(p.title)}</a></li>`;
      })
      .join('');
    return `<section><h2>${group}</h2><ul>${links}</ul></section>`;
  }).join('');
}

function tocHtml(page) {
  if (page.headings.length < 3) return '';
  const items = page.headings
    .map((h) => `<li class="${h.level}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`)
    .join('');
  return `<nav class="toc" aria-label="このページの目次"><h2>目次</h2><ul>${items}</ul></nav>`;
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
rmSync(outDir, { recursive: true, force: true });
for (const page of pages) {
  const cssHref = posix.relative(posix.dirname(page.out), 'assets/docs.css');
  const titleHtml = page.meta?.title ? `<h1>${escapeHtml(page.meta.title)}</h1>` : '';
  const doc = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} | mymind</title>
<link rel="stylesheet" href="${cssHref}">
</head>
<body>
<aside class="sidebar"><p class="brand">mymind <span>設計文書</span></p>${navHtml(page)}</aside>
<main>
<p class="source">正本：<code>${page.src}</code>（この HTML は生成物です。編集は Markdown で行ってください）</p>
${titleHtml}${metaHtml(page)}
<article>${page.html}</article>
<p class="generated">生成：${generatedAt}</p>
</main>
${tocHtml(page)}
</body>
</html>
`;
  const target = join(outDir, page.out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, doc);
}

mkdirSync(join(outDir, 'assets'), { recursive: true });
writeFileSync(
  join(outDir, 'assets/docs.css'),
  readFileSync(join(root, 'scripts/docs-assets/docs.css'), 'utf8'),
);
writeFileSync(
  join(outDir, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=docs/index.html"><title>mymind</title><a href="docs/index.html">設計文書へ</a>\n',
);
console.log(`設計文書 ${pages.length} ページを ${relative(root, outDir)}/ に出力しました`);
console.log(`開く: open ${relative(root, join(outDir, 'docs/index.html'))}`);
