import { type KeyboardEvent, useId, useState } from 'react';
import { keyName } from '../keyboard';
import type { KeyAction, KeyCommand } from '../keymap';
import { Kbd } from './Kbd';

/** 名前かキーの表示に、入力した文字を含む操作（大文字と小文字は区別しない） */
export function filterCommands(commands: readonly KeyCommand[], query: string): KeyCommand[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...commands];
  return commands.filter(
    (c) => c.label.toLowerCase().includes(q) || c.keys.some((k) => k.toLowerCase().includes(q)),
  );
}

/**
 * コマンドパレット（FR-U02、DESIGN.md 4.16）。今の画面で使える操作を検索して実行する。
 * 操作の一覧はキーマップの定義から作り（keymap.ts の commandsFor）、選んだ操作はキーと同じ処理で実行する
 */
export function CommandPalette({
  commands,
  onRun,
  onClose,
}: {
  commands: readonly KeyCommand[];
  onRun: (action: KeyAction) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const filtered = filterCommands(commands, query);
  const current = filtered[Math.min(active, filtered.length - 1)];

  const onKeyDown = (e: KeyboardEvent) => {
    // パレットを開いている間は、画面のショートカットを発火させない
    e.stopPropagation();
    const name = keyName(e.nativeEvent);
    if (name === 'Escape' || name === 'Meta+k') {
      e.preventDefault();
      onClose();
    } else if (name === 'ArrowDown' || name === 'ArrowUp') {
      e.preventDefault();
      const step = name === 'ArrowDown' ? 1 : -1;
      setActive(
        (i) => (Math.min(i, filtered.length - 1) + step + filtered.length) % filtered.length,
      );
    } else if (name === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (current !== undefined) onRun(current.action);
    } else if (name === 'Tab' || name === 'Shift+Tab') {
      // 入力欄の外へフォーカスを出さない（候補は ↑↓ で選ぶ）
      e.preventDefault();
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog palette glass-4"
        role="dialog"
        aria-modal="true"
        aria-label="コマンドパレット"
        onKeyDown={onKeyDown}
      >
        <input
          className="palette-input"
          role="combobox"
          aria-label="操作を検索"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={current === undefined ? undefined : `${id}-${current.action}`}
          placeholder="操作を検索（↑↓で選んで Enter）"
          // パレットを開いたら、すぐに入力できるようにする
          // biome-ignore lint/a11y/noAutofocus: ダイアログを開いた直後のフォーカスの置き場所
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <div id={`${id}-list`} className="palette-list" role="listbox" aria-label="操作">
          {filtered.map((c) => (
            <div
              key={c.action}
              id={`${id}-${c.action}`}
              role="option"
              aria-selected={c === current}
              // 候補は入力欄の aria-activedescendant で選ぶので、Tab では止まらない
              tabIndex={-1}
              className="palette-option"
              // クリックしても入力欄からフォーカスを外さない
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRun(c.action)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRun(c.action);
              }}
            >
              <span>{c.label}</span>
              <span className="palette-keys">
                {c.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        {filtered.length === 0 && <p className="text-small">一致する操作がありません</p>}
      </div>
    </div>
  );
}
