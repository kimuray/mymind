import { type RefObject, useLayoutEffect, useRef } from 'react';
import { readMotionTokens } from './listMotion';

/** これより短い間隔で続けて入れ替わったら、J・K で続けて選んでいるとみなして動かさない */
const REPEAT_INTERVAL_MS = 150;

/** 中身の入れ替えに動きを付けるか（DESIGN.md 3章）。続けて入れ替えているときと「視差効果を減らす」では付けない */
export function shouldAnimateSwap(now: number, previous: number, reducedMotion: boolean): boolean {
  return !reducedMotion && now - previous >= REPEAT_INTERVAL_MS;
}

/**
 * 詳細ペインの中身が入れ替わったとき（別の項目を選んだ、選択を外した）、短くフェードインさせる（FR-U04、NFR-29）。
 * 中身を作り直さずに、包む要素を Web Animations で動かす。key は「何を出しているか」の識別子
 */
export function useDetailSwap(content: RefObject<HTMLElement | null>, key: string | null) {
  const previousKey = useRef(key);
  const previousAt = useRef(Number.NEGATIVE_INFINITY);

  useLayoutEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    const now = performance.now();
    const animate = shouldAnimateSwap(
      now,
      previousAt.current,
      matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    previousAt.current = now;
    const el = content.current;
    if (!animate || el === null) return;
    const t = readMotionTokens();
    el.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: t.base, easing: t.easeOut, id: 'detail-swap' },
    );
  }, [content, key]);
}
