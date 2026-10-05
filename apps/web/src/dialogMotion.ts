import { type RefObject, useLayoutEffect } from 'react';
import { readMotionTokens } from './listMotion';

/**
 * ダイアログを閉じたとき、写しを元の場所に重ねて消す（FR-U02、FR-U03、DESIGN.md 4.9）。
 * 開くときの動きは CSS（components.css の dialog-in）で付ける。閉じるときは React がすぐに外すので、
 * 外す直前に写しを取り、外されたのを確かめてから body の上で消す。写しは操作も読み上げも受けない。
 * フォーカスはすぐに元の場所へ戻り、画面のキー操作も止めない（写しを待たない）
 */
export function useDialogExit(backdrop: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = backdrop.current;
    if (node === null) return;
    return () => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const ghost = node.cloneNode(true);
      if (!(ghost instanceof HTMLElement)) return;
      // 開発時の StrictMode は effect を付け直すだけで要素を外さないので、外されたときだけ写しを出す
      queueMicrotask(() => {
        if (node.isConnected) return;
        playDialogExit(ghost);
      });
    };
  }, [backdrop]);
}

function playDialogExit(ghost: HTMLElement) {
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add('dialog-leaving');
  document.body.append(ghost);
  const t = readMotionTokens();
  const options = { duration: t.fast, easing: t.easeOut, fill: 'forwards' as const };
  const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], options);
  ghost
    .querySelector('.dialog')
    ?.animate([{ transform: 'none' }, { transform: 'scale(0.97)' }], options);
  const remove = () => ghost.remove();
  fade.addEventListener('finish', remove);
  fade.addEventListener('cancel', remove);
}
