// DESIGN.md のトークン以外の色の直書きを検出する（.claude/rules/ui.md）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const targetDir = join(root, 'apps/web/src');
const allowList = [/styles\/tokens\.css$/, /\.test\.tsx?$/, /\.stories\.tsx?$/];
const patterns = [
  { name: '16進数の色', re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'rgb/rgba/hsl', re: /\b(?:rgba?|hsla?)\(/g },
];

function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files = files.concat(walk(p));
    else if (/\.(tsx?|css)$/.test(entry)) files.push(p);
  }
  return files;
}

let exists = true;
try {
  statSync(targetDir);
} catch {
  exists = false;
}
if (!exists) {
  console.log('apps/web/src がまだないため、デザイントークンの検査をスキップしました');
  process.exit(0);
}

const problems = [];
for (const file of walk(targetDir)) {
  if (allowList.some((re) => re.test(file))) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      if (re.test(line))
        problems.push(`${relative(root, file)}:${i + 1} ${name}の直書き: ${line.trim()}`);
    }
  });
}

if (problems.length > 0) {
  console.error('DESIGN.md のトークン（CSS 変数）を使ってください:\n');
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('デザイントークンの検査に問題はありませんでした');
