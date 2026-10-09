import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ニューモフィズムの土台（ADR-0018、ADR-0019、DESIGN.md 2.3）。
// ガラスの表現（半透明の面、背景のにじみ、backdrop-filter）が戻ってこないことを確かめる

const dir = new URL('./', import.meta.url);
const tokens = readFileSync(new URL('./tokens.css', dir), 'utf8');
const cssFiles = readdirSync(dir).filter((name) => name.endsWith('.css'));

const value = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

describe('NFR-22 ニューモフィズムの面', () => {
  it('面の色（--surface）は地の色（--ground）と同じ', () => {
    expect(value('surface')).toBeDefined();
    expect(value('surface')).toBe(value('ground'));
  });

  it('ガラスと背景のにじみのトークンがない', () => {
    expect(tokens).not.toMatch(/--(glass|blob)-/);
    expect(tokens).not.toMatch(/--ground-evening/);
  });

  it('面の塗りに白の半透明を使わない（白は影の明るい側、縁、濃いボタンの上の層だけ）', () => {
    const allowed = new Set([
      'neu-light',
      'neu-edge',
      'hover-fill-on-accent',
      'button-raised-on-dark',
      'button-raised',
      'kbd-bg-on-dark',
    ]);
    const root = tokens.split('@media')[0] ?? '';
    const whites = [...root.matchAll(/--([\w-]+):[^;]*rgba\(255, 255, 255/g)].map((m) => m[1]);
    expect(whites.filter((name) => !allowed.has(name ?? ''))).toEqual([]);
  });

  for (const name of cssFiles) {
    it(`${name} は backdrop-filter を使わない`, () => {
      const css = readFileSync(new URL(name, dir), 'utf8');
      expect(css).not.toMatch(/backdrop-filter\s*:/);
    });
  }

  it('「コントラストを上げる」設定で、面の縁を濃い線にする', () => {
    const more = tokens.match(/@media \(prefers-contrast: more\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(more).toMatch(/--neu-edge:\s*1px solid rgba\(26, 31, 41, 0\.24\)/);
  });
});
