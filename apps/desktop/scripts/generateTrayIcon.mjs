// メニューバーのアイコン（マメの形、テンプレート画像）を作る。macOS は黒と透明度だけを見て、明るさに合わせて色を変える。
// 作り直すときは node apps/desktop/scripts/generateTrayIcon.mjs を実行する
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** 0〜1 の座標で、その点がマメ（丸い体と、上の芽）の中か */
const inside = (x, y) => {
  const body = ((x - 0.5) / 0.38) ** 2 + ((y - 0.6) / 0.34) ** 2 <= 1;
  const stem = Math.abs(x - 0.5) <= 0.045 && y >= 0.12 && y <= 0.3;
  const leaf = ((x - 0.64) / 0.13) ** 2 + ((y - 0.16) / 0.07) ** 2 <= 1;
  return body || stem || leaf;
};

function png(size) {
  const samples = 4;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++)
          if (inside((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size)) hit++;
      row.push(0, 0, 0, Math.round((255 * hit) / samples ** 2));
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = new URL('../assets/', import.meta.url);
writeFileSync(new URL('trayTemplate.png', dir), png(16));
writeFileSync(new URL('trayTemplate@2x.png', dir), png(32));
