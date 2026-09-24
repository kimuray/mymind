import { useEffect, useRef } from 'react';
import { KEY_BINDINGS, type KeyAction, type KeyBinding } from './keymap';

/** キーボードの出来事を「Meta+ArrowUp」「Shift+Tab」「j」のような名前にする */
export function keyName(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
): string {
  const printable = e.key.length === 1;
  const key = printable ? e.key.toLowerCase() : e.key;
  const mods = [
    e.metaKey || e.ctrlKey ? 'Meta' : null,
    // 文字のキーの Shift は文字そのものに表れるので、名前には付けない
    e.shiftKey && !printable ? 'Shift' : null,
  ].filter((m): m is string => m !== null);
  return [...mods, key].join('+');
}

export type MatchResult =
  | { kind: 'action'; action: KeyAction }
  | { kind: 'pending'; sequence: string[] }
  | { kind: 'none' };

/** これまでに押したキーの並びと、今押したキーから、割り当てを探す（G → T のような連続も扱う） */
export function matchKey(
  pending: readonly string[],
  key: string,
  bindings: readonly KeyBinding[] = KEY_BINDINGS,
): MatchResult {
  const tryMatch = (sequence: string[]): MatchResult => {
    const candidates = bindings.filter((b) => sequence.every((k, i) => b.keys[i] === k));
    const exact = candidates.find((b) => b.keys.length === sequence.length);
    // 連続の途中（G だけ押した）なら、単独の割り当てより続きを待つ
    if (candidates.some((b) => b.keys.length > sequence.length)) {
      return { kind: 'pending', sequence };
    }
    return exact === undefined ? { kind: 'none' } : { kind: 'action', action: exact.action };
  };
  if (pending.length > 0) {
    const continued = tryMatch([...pending, key]);
    if (continued.kind !== 'none') return continued;
  }
  return tryMatch([key]);
}

/** 文字を入力している場所か。ここでは修飾キーなしのショートカットを発火させない（ui.md） */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** 割り当てた操作の処理。true を返したら、その操作を実行したとしてブラウザの既定の動作を止める */
export type KeyHandlers = Partial<Record<KeyAction, (e: KeyboardEvent) => boolean>>;

// 画面ごとの処理を登録する場所。キーの並び（G → T）を1か所で解釈するため、リスナーはアプリで1つにする
const registry: KeyHandlers[] = [];
let pending: string[] = [];
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let installed = false;

function onKeyDown(e: KeyboardEvent) {
  // 日本語入力の変換中は何もしない
  if (e.isComposing || e.keyCode === 229) return;
  const name = keyName(e);
  const hasModifier = e.metaKey || e.ctrlKey;
  if (isTypingTarget(e.target) && !hasModifier) return;
  // ボタンにフォーカスがあるときの Space / Enter は、ボタンのクリックに任せる（二重に進めないため）
  if ((name === ' ' || name === 'Enter') && e.target instanceof HTMLButtonElement) return;

  const result = matchKey(pending, name);
  clearTimeout(pendingTimer);
  if (result.kind === 'pending') {
    pending = result.sequence;
    pendingTimer = setTimeout(() => {
      pending = [];
    }, 1500);
    return;
  }
  pending = [];
  if (result.kind === 'none') return;
  // 後から登録した（今表示している画面の）処理を優先する
  for (let i = registry.length - 1; i >= 0; i--) {
    const handler = registry[i]?.[result.action];
    if (handler !== undefined) {
      if (handler(e)) e.preventDefault();
      return;
    }
  }
}

/** 画面が担当する操作を登録する。画面を離れると外れる */
export function useKeyBindings(handlers: KeyHandlers) {
  // 毎回の描画で最新の処理を使えるよう、登録するのは ref を通した入れ物にする
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!installed) {
      window.addEventListener('keydown', onKeyDown);
      installed = true;
    }
    const proxy: KeyHandlers = {};
    for (const action of Object.keys(ref.current) as KeyAction[]) {
      proxy[action] = (e) => ref.current[action]?.(e) ?? false;
    }
    registry.push(proxy);
    return () => {
      const i = registry.indexOf(proxy);
      if (i >= 0) registry.splice(i, 1);
    };
  }, []);
}
