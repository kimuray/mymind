import { describe, expect, it } from 'vitest';
import { EDITOR_KEYS, KEY_BINDINGS } from '../../web/src/keymap';
import { buildAppMenu, menuAccelerators, toKeymapNotation } from './appMenu';

/** 画面のキーのうち、修飾キー付きのもの（メニューのキーと重なりうるもの） */
const screenKeys = new Set([
  ...KEY_BINDINGS.flatMap((b) => b.keys).filter((k) => k.includes('+')),
  // 入力欄の太字（Mod-b）
  toKeymapNotation(EDITOR_KEYS.bold.replace('Mod-', 'Command+')),
]);

describe('FR-U01 デスクトップアプリのメニュー', () => {
  it.each([
    ['開発時', true],
    ['.app', false],
  ])('%s のメニューのキーは、画面のショートカットと重ならない', (_, isDev) => {
    const keys = menuAccelerators(buildAppMenu({ isDev })).map(toKeymapNotation);
    expect(keys.filter((k) => screenKeys.has(k))).toEqual([]);
  });

  it('画面のキーマップには、メニューと重なりうる ⌘K・⌘P・⌘S・⌘↵ がある（突き合わせが働いている）', () => {
    expect([...screenKeys]).toEqual(
      expect.arrayContaining(['Meta+k', 'Meta+p', 'Meta+s', 'Meta+Enter', 'Meta+b']),
    );
  });

  it('mymind・編集・表示・ウィンドウの順に並べ、編集では標準のコピーや貼り付けを使える', () => {
    const menu = buildAppMenu({ isDev: false });
    expect(menu.map((m) => ('label' in m ? m.label : ''))).toEqual([
      'mymind',
      '編集',
      '表示',
      'ウィンドウ',
    ]);
    const edit = menu[1];
    expect(edit !== undefined && 'submenu' in edit ? edit.submenu : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'copy' }),
        expect.objectContaining({ role: 'paste' }),
        expect.objectContaining({ role: 'selectAll' }),
      ]),
    );
  });

  it('読み直しと開発者ツールは、開発時だけ出す', () => {
    const roles = (isDev: boolean) =>
      JSON.stringify(buildAppMenu({ isDev })).match(/"role":"(reload|toggleDevTools)"/g) ?? [];
    expect(roles(true)).toHaveLength(2);
    expect(roles(false)).toEqual([]);
  });

  it.each([
    ['Command+Q', 'Meta+q'],
    ['Shift+Command+Z', 'Meta+Shift+z'],
    ['Control+Command+F', 'Meta+Control+f'],
    ['Command+Plus', 'Meta++'],
    ['Alt+Command+I', 'Meta+Alt+i'],
  ])('%s を画面のキーマップの書き方 %s にそろえる', (accelerator, expected) => {
    expect(toKeymapNotation(accelerator)).toBe(expected);
  });
});
