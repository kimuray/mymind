// アイコンを作るための、依存関係のない PNG と ICNS の書き出し（generateTrayIcon.mjs、generateAppIcon.mjs）
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

/**
 * size×size の RGBA の PNG を作る。paint(x, y) は 0〜1 の座標の色 [r, g, b, a]（0〜255）を返す。
 * 1画素を samples×samples に分けて平均し、縁を滑らかにする
 */
export function encodePng(size, paint, samples = 4) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          const [r, g, b, a] = paint(
            (x + (sx + 0.5) / samples) / size,
            (y + (sy + 0.5) / samples) / size,
          );
          // 透明度で重みを付けて混ぜる（透明な部分の色が縁ににじまないように）
          sum[0] += r * a;
          sum[1] += g * a;
          sum[2] += b * a;
          sum[3] += a;
        }
      const alpha = sum[3] / samples ** 2;
      const div = sum[3] === 0 ? 1 : sum[3];
      row.push(
        Math.round(sum[0] / div),
        Math.round(sum[1] / div),
        Math.round(sum[2] / div),
        Math.round(alpha),
      );
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

/** PNG をそのまま入れた ICNS（macOS のアプリのアイコン）。entries は [種類, PNG] の並び（ic07〜ic14） */
export function encodeIcns(entries) {
  const parts = entries.map(([type, png]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}
