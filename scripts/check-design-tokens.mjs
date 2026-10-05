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

/** 動きの宣言の値から、トークン（var(--...)）と止めるための値を除いて、直書きの時間・緩急を探す */
function motionLiteralsIn(value) {
  const rest = value.replace(/var\(--[\w-]+\)/g, '').replace(stopValue, '');
  return motionPatterns.filter(({ re }) => re.test(rest)).map(({ name }) => name);
}

/** 1行の中の動きの宣言（TS のインラインのスタイル） */
function findMotionLiterals(line) {
  if (!motionDeclaration.test(line)) return [];
  return motionLiteralsIn(
    line.slice(line.search(motionDeclaration)).replace(motionDeclaration, ''),
  );
}

/**
 * CSS の動きの宣言を、セミコロン（か宣言の終わり）までまとめて調べる。
 * 整形で値が複数行に分かれても（animation:\n  spin 300ms ...）見落とさないため。行番号は宣言の始まり
 */
function findMotionLiteralsInCss(text) {
  const declaration = new RegExp(`${motionDeclaration.source}([^;{}]*)`, 'g');
  const found = [];
  for (const match of text.matchAll(declaration)) {
    const line = text.slice(0, match.index).split('\n').length;
    for (const name of motionLiteralsIn(match[1] ?? '')) {
      found.push({ line, name, text: match[0].replace(/\s+/g, ' ').trim() });
    }
  }
  return found;
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
  const text = readFileSync(file, 'utf8');
  const isCss = file.endsWith('.css');
  text.split('\n').forEach((line, i) => {
    for (const { name, re } of patterns) {
      re.lastIndex = 0;
      if (re.test(line))
        problems.push(`${relative(root, file)}:${i + 1} ${name}の直書き: ${line.trim()}`);
    }
    if (isCss) return;
    for (const name of findMotionLiterals(line)) {
      problems.push(`${relative(root, file)}:${i + 1} ${name}の直書き: ${line.trim()}`);
    }
  });
  if (isCss) {
    for (const { line, name, text: declaration } of findMotionLiteralsInCss(text)) {
      problems.push(`${relative(root, file)}:${line} ${name}の直書き: ${declaration}`);
    }
  }
}

if (problems.length > 0) {
  console.error('DESIGN.md のトークン（CSS 変数）を使ってください:\n');
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('デザイントークンの検査に問題はありませんでした');
