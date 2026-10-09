// アプリのアイコン（Dock と Finder に出る、マメの顔）を作る。色は DESIGN.md のトークンの値を使う。
// 作り直すときは node apps/desktop/scripts/generateAppIcon.mjs を実行する
import { writeFileSync } from 'node:fs';
import { encodeIcns, encodePng } from './png.mjs';

const hex = (h) => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
];
// DESIGN.md 3.1 と 4.1 のトークン（面、--mame-good、--mame-face、--mame-stem、--mame-leaf）。面の色は M8 の #243 で --surface にする
const PAPER = hex('#fbf9f5');
const BODY = hex('#f2b27e');
const FACE = hex('#1f1d1a');
const STEM = hex('#3e7a55');
const LEAF = hex('#86bf98');

const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** macOS のアイコンの形（角を丸めた四角）。内側に少し余白を取る */
const inPlate = (x, y) => {
  const m = 0.1;
  const r = 0.18;
  const cx = Math.min(Math.max(x, m + r), 1 - m - r);
  const cy = Math.min(Math.max(y, m + r), 1 - m - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= m && x <= 1 - m && y >= m && y <= 1 - m;
};

function paint(x, y) {
  if (!inPlate(x, y)) return [0, 0, 0, 0];
  // 顔（目と口）、体、芽、葉の順に重ねる
  if (ellipse(x, y, 0.42, 0.58, 0.028, 0.04) || ellipse(x, y, 0.58, 0.58, 0.028, 0.04))
    return [...FACE, 255];
  const mouth = ellipse(x, y, 0.5, 0.66, 0.06, 0.035) && !ellipse(x, y, 0.5, 0.645, 0.06, 0.035);
  if (mouth) return [...FACE, 255];
  if (ellipse(x, y, 0.5, 0.6, 0.27, 0.24)) return [...BODY, 255];
  if (Math.abs(x - 0.5) <= 0.018 && y >= 0.27 && y <= 0.38) return [...STEM, 255];
  if (ellipse(x, y, 0.575, 0.28, 0.075, 0.04)) return [...LEAF, 255];
  return [...PAPER, 255];
}

const dir = new URL('../assets/', import.meta.url);
// 開発時の Dock のアイコン
writeFileSync(new URL('icon.png', dir), encodePng(512, paint, 2));
// .app のアイコン（@electron/packager に渡す）
writeFileSync(
  new URL('icon.icns', dir),
  encodeIcns([
    ['ic07', encodePng(128, paint, 3)],
    ['ic08', encodePng(256, paint, 2)],
    ['ic09', encodePng(512, paint, 2)],
    ['ic10', encodePng(1024, paint, 1)],
  ]),
);
