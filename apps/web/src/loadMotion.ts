import { type RefObject, useLayoutEffect, useRef } from 'react';
import { readMotionTokens } from './listMotion';

/**
 * 読み込み中を経て中身が出たとき、中身を短くフェードインさせる（DESIGN.md 4.19、NFR-29）。
 * 画面を開いたときにすでに読み込めていれば（キャッシュがあれば）動かさない。
 * target は読み込みが終わって出る要素。initiallyLoading は、この部品を使う要素が読み込みの後に作られるとき
 * （振り返りの入力欄など）に、親が見ていた「読み込み中だったか」を引き継ぐためのもの
 */
export function useFadeInAfterLoading(
  target: RefObject<HTMLElement | null>,
  loading: boolean,
  initiallyLoading: boolean = loading,
) {
  const wasLoading = useRef(initiallyLoading);
  useLayoutEffect(() => {
    if (loading) {
      wasLoading.current = true;
      return;
    }
    if (!wasLoading.current) return;
    wasLoading.current = false;
    const el = target.current;
    if (el === null || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = readMotionTokens();
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: t.base,
      easing: t.easeOut,
      id: 'load-fade',
    });
  }, [target, loading]);
}
