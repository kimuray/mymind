import type { Status } from '@mymind/domain';
import { useEffect, useRef } from 'react';

/**
 * タスクごとに、最後に画面へ出した状態。完了にすると行は「完了」の欄へ移って作り直されるので、
 * 行の中ではなくモジュールに覚えておき、作り直された行でも状態が変わったことが分かるようにする。
 */
const shownStatus = new Map<string, Status>();

/**
 * 動きを付ける状態を決める（DESIGN.md 2.7、4.2）。画面を開いたときは動かさず、
 * 前に出した状態から変わったときだけ、その新しい状態に動きを付ける。
 * 同じ状態のあいだは前の判断を保つ（再描画で動きの途中に属性が外れないように）。
 */
export function resolveAnimatedStatus(
  shown: Status | undefined,
  status: Status,
  animated: Status | null,
): Status | null {
  if (shown !== undefined && shown !== status) return status;
  return animated === status ? animated : null;
}

/** 状態が変わった直後かどうか。変わった状態のあいだは true のまま（動きは要素を作り直したときだけ再生される） */
export function useStatusChanged(id: string, status: Status): boolean {
  const animated = useRef<Status | null>(null);
  // 描画の中では読むだけにし、覚えるのは effect で行う（二重の描画でも同じ結果になる）
  animated.current = resolveAnimatedStatus(shownStatus.get(id), status, animated.current);
  useEffect(() => {
    shownStatus.set(id, status);
  }, [id, status]);
  return animated.current === status;
}
