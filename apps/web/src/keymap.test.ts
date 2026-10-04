import { describe, expect, it } from 'vitest';
import { filterCommands } from './components/CommandPalette';
import { matchKey } from './keyboard';
import { commandsFor, formatKeys, KEY_BINDINGS, type KeyAction } from './keymap';

describe('FR-U02 FR-U03 キーの表示', () => {
  it('修飾キーと矢印を記号にし、連続は「→」でつなぐ', () => {
    expect(formatKeys(['Meta+k'])).toBe('⌘K');
    expect(formatKeys(['Meta+Enter'])).toBe('⌘↵');
    expect(formatKeys(['g', 't'])).toBe('G → T');
    expect(formatKeys(['ArrowDown'])).toBe('↓');
    expect(formatKeys([' '])).toBe('Space');
    expect(formatKeys(['Shift+Tab'])).toBe('⇧Tab');
    expect(formatKeys(['?'])).toBe('?');
  });

  it('⌘K でコマンドパレット、? でショートカットの一覧を開く', () => {
    expect(matchKey([], 'Meta+k')).toEqual({ kind: 'action', action: 'palette.open' });
    expect(matchKey([], '?')).toEqual({ kind: 'action', action: 'help.open' });
  });
});

describe('FR-U02 FR-U03 キーマップの定義から作る操作の一覧', () => {
  it('使える操作だけを定義の順に並べ、1つの操作の複数のキーをまとめる', () => {
    const commands = commandsFor(new Set<KeyAction>(['list.next', 'nav.today']));
    expect(commands).toEqual([
      { action: 'nav.today', label: '今日', keys: ['G → T'] },
      { action: 'list.next', label: '次のタスク', keys: ['J', '↓'] },
    ]);
  });

  it('すべての操作に名前があり、定義にない操作は出さない', () => {
    const all = new Set(KEY_BINDINGS.map((b) => b.action));
    const commands = commandsFor(all);
    expect(commands.map((c) => c.action).sort()).toEqual([...all].sort());
    expect(commands.every((c) => c.label !== '')).toBe(true);
  });

  it('名前かキーの表示で絞り込み、空なら全部を返す', () => {
    const commands = commandsFor(new Set<KeyAction>(['nav.today', 'nav.backlog', 'task.new']));
    expect(filterCommands(commands, 'バックログ').map((c) => c.action)).toEqual(['nav.backlog']);
    expect(filterCommands(commands, 'g → t').map((c) => c.action)).toEqual(['nav.today']);
    expect(filterCommands(commands, '  ')).toHaveLength(3);
    expect(filterCommands(commands, 'ない操作')).toEqual([]);
  });
});
