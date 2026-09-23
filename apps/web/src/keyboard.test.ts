import { describe, expect, it } from 'vitest';
import { keyName, matchKey } from './keyboard';
import { KEY_BINDINGS } from './keymap';

const ev = (key: string, mods: { meta?: boolean; shift?: boolean } = {}) => ({
  key,
  metaKey: mods.meta ?? false,
  ctrlKey: false,
  shiftKey: mods.shift ?? false,
});

describe('FR-U01 キーの名前', () => {
  it('文字のキーは小文字にする（Shift は文字に表れる）', () => {
    expect(keyName(ev('J', { shift: true }))).toBe('j');
  });

  it('修飾キーを前に付ける', () => {
    expect(keyName(ev('ArrowUp', { meta: true }))).toBe('Meta+ArrowUp');
    expect(keyName(ev('Tab', { shift: true }))).toBe('Shift+Tab');
  });
});

describe('FR-U01 キーの割り当ての照合', () => {
  it('単独のキーを操作に対応させる', () => {
    expect(matchKey([], 'j')).toEqual({ kind: 'action', action: 'list.next' });
    expect(matchKey([], 'Meta+ArrowDown')).toEqual({ kind: 'action', action: 'list.moveDown' });
  });

  it('G のあとは続きのキーを待ち、G → T で今日へ移る', () => {
    expect(matchKey([], 'g')).toEqual({ kind: 'pending', sequence: ['g'] });
    expect(matchKey(['g'], 't')).toEqual({ kind: 'action', action: 'nav.today' });
  });

  it('G のあとに続きのないキーが来たら、そのキー単独として扱う', () => {
    expect(matchKey(['g'], 'j')).toEqual({ kind: 'action', action: 'list.next' });
  });

  it('G を押していなければ、T はリストの「明日へ／今日へ」になる', () => {
    expect(matchKey([], 't')).toEqual({ kind: 'action', action: 'list.dayKey' });
  });

  it('割り当てのないキーは何もしない', () => {
    expect(matchKey([], 'q')).toEqual({ kind: 'none' });
  });

  it('同じキーの並びを2つの操作に割り当てていない', () => {
    const sequences = KEY_BINDINGS.map((b) => b.keys.join(' '));
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});
