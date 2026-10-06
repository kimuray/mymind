// メニューバーのアイコン（マメの形、テンプレート画像）を作る。macOS は黒と透明度だけを見て、明るさに合わせて色を変える。
// 作り直すときは node apps/desktop/scripts/generateTrayIcon.mjs を実行する
import { writeFileSync } from 'node:fs';
import { encodePng } from './png.mjs';

/** 0〜1 の座標で、その点がマメ（丸い体と、上の芽）の中か */
const inside = (x, y) => {
  const body = ((x - 0.5) / 0.38) ** 2 + ((y - 0.6) / 0.34) ** 2 <= 1;
  const stem = Math.abs(x - 0.5) <= 0.045 && y >= 0.12 && y <= 0.3;
  const leaf = ((x - 0.64) / 0.13) ** 2 + ((y - 0.16) / 0.07) ** 2 <= 1;
  return body || stem || leaf;
};

const paint = (x, y) => (inside(x, y) ? [0, 0, 0, 255] : [0, 0, 0, 0]);
const dir = new URL('../assets/', import.meta.url);
writeFileSync(new URL('trayTemplate.png', dir), encodePng(16, paint));
writeFileSync(new URL('trayTemplate@2x.png', dir), encodePng(32, paint));
