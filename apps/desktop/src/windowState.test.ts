import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fitWindowBounds, readWindowBounds, writeWindowBounds } from './windowState';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mymind-window-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const external = { x: 1512, y: 0, width: 2560, height: 1415 };

describe('FR-U01 ウィンドウの大きさと位置を覚える', () => {
  it('覚えておいた位置と大きさを、本人だけが読めるファイルに残して読み戻す', () => {
    const path = join(dir, 'window-state.json');
    writeWindowBounds(path, { x: 100, y: 80, width: 1200, height: 800 });
    expect(readWindowBounds(path)).toEqual({ x: 100, y: 80, width: 1200, height: 800 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('まだ覚えていない、または壊れていれば null', () => {
    expect(readWindowBounds(join(dir, 'missing.json'))).toBeNull();
    const path = join(dir, 'window-state.json');
    writeFileSync(path, '{"x":"left"}');
    expect(readWindowBounds(path)).toBeNull();
  });

  it('初めて開くときは、いちばん目の画面の中央に 1440×900 で開く（画面が小さければ縮める）', () => {
    expect(fitWindowBounds(null, [laptop])).toEqual({
      x: 36,
      y: 35,
      width: 1440,
      height: 900,
    });
    expect(fitWindowBounds(null, [{ x: 0, y: 0, width: 1280, height: 760 }])).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 760,
    });
  });

  it('覚えておいた位置が見えていれば、そのまま開く', () => {
    const saved = { x: 1700, y: 100, width: 1400, height: 900 };
    expect(fitWindowBounds(saved, [laptop, external])).toEqual(saved);
  });

  it('外したディスプレイの上にあったときは、いちばん目の画面の中央に戻す', () => {
    const saved = { x: 1700, y: 100, width: 1400, height: 900 };
    expect(fitWindowBounds(saved, [laptop])).toEqual({ x: 36, y: 35, width: 1440, height: 900 });
  });

  it('画面から少しはみ出していれば、はみ出した分だけ中へ戻し、最小の大きさは守る', () => {
    expect(fitWindowBounds({ x: 1000, y: 500, width: 800, height: 600 }, [laptop])).toEqual({
      x: 552,
      y: 305,
      width: 960,
      height: 640,
    });
  });
});
