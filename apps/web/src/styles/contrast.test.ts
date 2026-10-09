import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// トークンの値からコントラスト比を計算する（NFR-06、DESIGN.md 7章）。
// 画面の E2E（axe）より先に、トークンを変えた時点で文字が読めることを確かめる

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const components = readFileSync(new URL('./components.css', import.meta.url), 'utf8');

/** 読み込み中の文と処理中のボタンを点滅させるときの、いちばん薄い不透明度（components.css の soft-pulse） */
const pulseOpacity = Number(
  components.match(/@keyframes soft-pulse\s*\{\s*50%\s*\{\s*opacity:\s*([\d.]+);/)?.[1],
);

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
/** ニューモフィズムの面は地と同じ色で塗る（DESIGN.md 2.3）。影は文字の後ろにかからない */
const surfaces = {
  地色: ground,
  面: token('surface'),
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
      const badge = over(token(`status-${status}-bg`), surfaces.面);
      expect(contrast(token(`status-${status}-text`), badge)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const color of ['rose', 'amber', 'green', 'teal', 'indigo', 'plum']) {
    it(`FR-T13 タグのチップ（${color}）の文字は、リストの上のチップの背景に対して 4.5:1 以上`, () => {
      const chip = over(token(`tag-${color}-bg`), surfaces.面);
      expect(contrast(token(`tag-${color}-text`), chip)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('主ボタンの白い文字は、主ボタンの塗りに対して 4.5:1 以上', () => {
    expect(contrast(token('text-on-accent'), token('button-primary-bg'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('確定ボタンの白い文字は、確定ボタンの塗りに対して 4.5:1 以上', () => {
    expect(contrast(token('text-on-accent'), token('button-confirm-bg'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('送信内容の注記（FR-A12）の文字は、強調の背景に対して 4.5:1 以上', () => {
    const highlight = over(token('status-paused-bg'), surfaces.面);
    expect(contrast(token('status-paused-text'), highlight)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('ink-2'), highlight)).toBeGreaterThanOrEqual(4.5);
  });

  describe('点滅のいちばん薄いところ（DESIGN.md 4.19）', () => {
    const grounds = { 地色: ground };
    /** 要素ごと不透明度を下げたときの色（下の地が透ける） */
    const faded = ([r, g, b]: Rgba, under: Rgba) => over([r, g, b, pulseOpacity], under);

    it('点滅の不透明度を components.css から読める', () => {
      expect(pulseOpacity).toBeGreaterThan(0);
      expect(pulseOpacity).toBeLessThan(1);
    });

    for (const [name, under] of Object.entries(grounds)) {
      it(`読み込み中の文（--ink-2）は、${name}の上で点滅しても 4.5:1 以上`, () => {
        expect(contrast(faded(token('ink-2'), under), under)).toBeGreaterThanOrEqual(4.5);
      });

      it(`処理中の主ボタンの白い文字は、${name}の上で点滅しても 4.5:1 以上`, () => {
        const fill = faded(token('button-primary-bg'), under);
        expect(contrast(faded(token('text-on-accent'), under), fill)).toBeGreaterThanOrEqual(4.5);
      });

      it(`処理中の確定ボタンの白い文字は、${name}の上で点滅しても 4.5:1 以上`, () => {
        const fill = faded(over(token('button-confirm-bg'), under), under);
        expect(contrast(faded(token('text-on-accent'), under), fill)).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
});
