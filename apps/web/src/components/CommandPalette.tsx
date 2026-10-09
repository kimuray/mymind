import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useDialogExit } from '../dialogMotion';
import { keyName } from '../keyboard';
import { useSelectionMotion } from '../selectionMotion';
import { Kbd } from './Kbd';

/** パレットの候補。キーマップの操作と、画面の内容から作る操作（keyboard.ts の usePaletteCommands）をまとめて扱う */
export type PaletteItem = { id: string; label: string; keys: readonly string[]; run: () => void };

/** 名前かキーの表示に、入力した文字を含む操作（大文字と小文字は区別しない） */
export function filterCommands<T extends { label: string; keys: readonly string[] }>(
  commands: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...commands];
  return commands.filter(
    (c) => c.label.toLowerCase().includes(q) || c.keys.some((k) => k.toLowerCase().includes(q)),
  );
}

/**
 * コマンドパレット（FR-U02、DESIGN.md 4.16）。今の画面で使える操作を検索して実行する。
 * 操作の一覧はキーマップの定義から作り（keymap.ts の commandsFor）、選んだ操作はキーと同じ処理で実行する。
 * 画面の内容から作る操作（タグで絞り込む、など）も、画面が登録したものを後ろに並べる
 */
export function CommandPalette({
  commands,
  onRun,
  onClose,
}: {
  commands: readonly PaletteItem[];
  onRun: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // 選んだ候補の面を滑らせ、リストの外に出たら追従する（DESIGN.md 4.16、5.2）
  const list = useRef<HTMLDivElement>(null);
  // 閉じたとき、写しを消して閉じる動きにする（DESIGN.md 4.9）
  const backdrop = useRef<HTMLDivElement>(null);
  useDialogExit(backdrop);
  useSelectionMotion(list);
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
      if (current !== undefined) onRun(current);
    } else if (name === 'Tab' || name === 'Shift+Tab') {
      // 入力欄の外へフォーカスを出さない（候補は ↑↓ で選ぶ）
      e.preventDefault();
    }
  };

  return (
    <div ref={backdrop} className="dialog-backdrop">
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
          aria-activedescendant={current === undefined ? undefined : `${id}-${current.id}`}
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
        <div id={`${id}-list`} ref={list} className="palette-list" role="listbox" aria-label="操作">
          {filtered.map((c) => (
            <div
              key={c.id}
              id={`${id}-${c.id}`}
              role="option"
              aria-selected={c === current}
              // 候補は入力欄の aria-activedescendant で選ぶので、Tab では止まらない
              tabIndex={-1}
              className="palette-option"
              // クリックしても入力欄からフォーカスを外さない
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onRun(c)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRun(c);
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
