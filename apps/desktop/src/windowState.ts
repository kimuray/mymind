import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

export type Rect = { x: number; y: number; width: number; height: number };

const rectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** ウィンドウの最小の大きさ（DESIGN.md 3.1） */
export const MIN_WINDOW = { width: 960, height: 640 };
/** 初めて開くときの大きさ */
export const DEFAULT_WINDOW = { width: 1440, height: 900 };

/** 覚えておいたウィンドウの位置と大きさ。なければ（または読めなければ）null */
export function readWindowBounds(path: string): Rect | null {
  try {
    const parsed = rectSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    // まだ覚えていない（初めて開く）、または壊れている。どちらも初めての大きさで開く
    return null;
  }
}

export function writeWindowBounds(path: string, bounds: Rect): void {
  writeFileSync(path, `${JSON.stringify(bounds)}\n`, { mode: 0o600 });
}

/** これより狭くしか見えないときは、画面の外に出ているとみなす（タイトルバーをつかめる程度） */
const MIN_VISIBLE = 100;

const visibleArea = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { w: Math.max(0, w), h: Math.max(0, h) };
};

/**
 * 次に開くときの位置と大きさを決める（FR-U01、DESIGN.md 3.1）。
 * 覚えておいた位置がどの画面（ディスプレイの作業領域）にも十分に見えないとき（外したディスプレイの上にあった、など）は、
 * いちばん目の画面の中央に初めての大きさで開く。大きさはその画面に収まるよう縮める
 */
export function fitWindowBounds(saved: Rect | null, workAreas: readonly Rect[]): Rect {
  const primary = workAreas[0] ?? { x: 0, y: 0, ...DEFAULT_WINDOW };
  const fitSize = (area: Rect, width: number, height: number) => ({
    width: Math.max(MIN_WINDOW.width, Math.min(width, area.width)),
    height: Math.max(MIN_WINDOW.height, Math.min(height, area.height)),
  });
  const onScreen =
    saved === null
      ? undefined
      : workAreas.find((area) => {
          const v = visibleArea(saved, area);
          return v.w >= MIN_VISIBLE && v.h >= MIN_VISIBLE;
        });
  if (saved === null || onScreen === undefined) {
    const size = fitSize(primary, DEFAULT_WINDOW.width, DEFAULT_WINDOW.height);
    return {
      ...size,
      x: Math.round(primary.x + (primary.width - size.width) / 2),
      y: Math.round(primary.y + (primary.height - size.height) / 2),
    };
  }
  const size = fitSize(onScreen, saved.width, saved.height);
  // 見えている画面からはみ出した分だけ、画面の中へ戻す
  const x = Math.min(Math.max(saved.x, onScreen.x), onScreen.x + onScreen.width - size.width);
  const y = Math.min(Math.max(saved.y, onScreen.y), onScreen.y + onScreen.height - size.height);
  return { ...size, x, y };
}
