import { type KeyboardEvent, useId, useRef } from 'react';
import { useDialogExit } from '../dialogMotion';
import { keyName } from '../keyboard';
import type { KeyCommand } from '../keymap';
import { Button } from './Button';
import { Kbd } from './Kbd';

/**
 * ショートカットの一覧（FR-U03、DESIGN.md 4.16）。今の画面で使えるキーを、キーマップの定義から作って出す
 */
export function ShortcutHelp({
  commands,
  onClose,
}: {
  commands: readonly KeyCommand[];
  onClose: () => void;
}) {
  const titleId = useId();
  // 閉じたとき、写しを消して閉じる動きにする（DESIGN.md 4.9）
  const backdrop = useRef<HTMLDivElement>(null);
  useDialogExit(backdrop);
  const onKeyDown = (e: KeyboardEvent) => {
    // 一覧を開いている間は、画面のショートカットを発火させない
    e.stopPropagation();
    const name = keyName(e.nativeEvent);
    if (name === 'Escape' || name === '?') {
      e.preventDefault();
      onClose();
    } else if (name === 'Tab' || name === 'Shift+Tab') {
      // フォーカスできるのは「閉じる」だけなので、ダイアログの外へ出さない
      e.preventDefault();
    }
  };
  return (
    <div ref={backdrop} className="dialog-backdrop">
      <div
        className="dialog shortcut-help neu-raised-3"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="text-title">
          ショートカットの一覧
        </h2>
        <dl className="shortcut-list">
          {commands.map((c) => (
            <div key={c.action}>
              <dt>{c.label}</dt>
              <dd>
                {c.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <div className="dialog-actions">
          {/* biome-ignore lint/a11y/noAutofocus: ダイアログを開いた直後のフォーカスの置き場所 */}
          <Button autoFocus onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  );
}
