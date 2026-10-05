// DESIGN.md のトークン以外の色の直書きと、動きの時間・緩急の直書きを検出する（.claude/rules/ui.md、DESIGN.md 2.7）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const targetDir = join(root, 'apps/web/src');
const allowList = [/styles\/tokens\.css$/, /\.test\.tsx?$/, /\.stories\.tsx?$/];
const patterns = [
  { name: '16進数の色', re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'rgb/rgba/hsl', re: /\b(?:rgba?|hsla?)\(/g },
];

// transition / animation の宣言（CSS）と、インラインのスタイル（transition: '...'）だけを見る
const motionDeclaration = /\b(?:transition|animation)(?:-duration|-delay|-timing-function)?\s*:/;
const motionPatterns = [
  { name: '動きの時間', re: /(?<![\w-])\d*\.?\d+m?s\b/ },
  { name: '動きの緩急', re: /\b(?:ease(?:-in|-out|-in-out)?|cubic-bezier|steps|linear)\b/ },
];
// 「視差効果を減らす」で動きを止めるための値（base.css）。時間のトークンの代わりではない
const stopValue = /\b0\.01ms\b/g;

/** 動きの宣言から、トークン（var(--...)）と止めるための値を除いて、直書きの時間・緩急を探す */
function findMotionLiterals(line) {
  if (!motionDeclaration.test(line)) return [];
  const value = line
    .slice(line.search(motionDeclaration))
    .replace(motionDeclaration, '')
    .replace(/var\(--[\w-]+\)/g, '')
    .replace(stopValue, '');
  return motionPatterns.filter(({ re }) => re.test(value)).map(({ name }) => name);
}

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
    for (const name of findMotionLiterals(line)) {
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
