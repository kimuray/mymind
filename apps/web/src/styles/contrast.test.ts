import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// トークンの値からコントラスト比を計算する（NFR-06、DESIGN.md 7章）。
// ガラスの面の上の文字は、画面の E2E（axe）では背景色を決められないので、ここで確かめる

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type Rgba = [number, number, number, number];

function token(name: string): Rgba {
  const value = css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  if (value === undefined) throw new Error(`トークンがありません: --${name}`);
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex !== undefined) {
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const rgba = value
    .match(/^rgba\(([^)]+)\)$/)?.[1]
    ?.split(',')
    .map((v) => Number(v.trim()));
  if (rgba?.length === 4) return rgba as Rgba;
  throw new Error(`色として読めません: --${name}: ${value}`);
}

/** 半透明の色を下の色の上に重ねる */
const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
  r * a + br * (1 - a),
  g * a + bg * (1 - a),
  b * a + bb * (1 - a),
  1,
];

const luminance = ([r, g, b]: Rgba) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const ground = token('ground');
/** 地色の上に重ねたガラスの面（背景のにじみがない場所） */
const surfaces = {
  地色: ground,
  サイドバー: over(token('glass-1'), ground),
  リスト: over(token('glass-2'), ground),
  詳細ペイン: over(token('glass-3'), ground),
  不透明な面: token('glass-opaque'),
};

describe('NFR-06 文字色のコントラスト', () => {
  for (const ink of ['ink-1', 'ink-2', 'ink-3', 'ink-4']) {
    for (const [name, surface] of Object.entries(surfaces)) {
      it(`--${ink} は${name}の上で 4.5:1 以上`, () => {
        expect(contrast(token(ink), surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const status of ['todo', 'doing', 'paused', 'waiting', 'done', 'cancelled']) {
    it(`状態のバッジ（${status}）の文字は、リストの上のバッジの背景に対して 4.5:1 以上`, () => {
      const badge = over(token(`status-${status}-bg`), surfaces.リスト);
      expect(contrast(token(`status-${status}-text`), badge)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('主ボタンの白い文字は、藍色の塗りに対して 4.5:1 以上', () => {
    expect(contrast(token('text-on-accent'), token('accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('確定ボタンの白い文字は、詳細ペインの上の塗りに対して 4.5:1 以上', () => {
    const fill = over(token('button-confirm-bg'), surfaces.詳細ペイン);
    expect(contrast(token('text-on-accent'), fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('送信内容の注記（FR-A12）の文字は、強調の背景に対して 4.5:1 以上', () => {
    const highlight = over(token('status-paused-bg'), over(token('glass-2'), surfaces.詳細ペイン));
    expect(contrast(token('status-paused-text'), highlight)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-2'), highlight)).toBeGreaterThanOrEqual(4.5);
  });
});
