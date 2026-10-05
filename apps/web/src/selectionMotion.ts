import { type RefObject, useLayoutEffect, useRef } from 'react';
import { offsetPosition, type RowPosition, readMotionTokens } from './listMotion';

/** 選択中の行。行の種類ごとに選択の印が違う（パレットの候補だけ aria-selected） */
const SELECTED_ROW =
  ':is(.task-row, .settings-row, .morning-row, .timeline-task)[data-selected="true"], .palette-option[aria-selected="true"]';

/** この部品が付けた動きの印 */
const ANIMATION_ID = 'selection-motion';

/**
 * 選択の面を、前の行の位置から新しい行へ滑らせるときのずれ（DESIGN.md 5.2）。
 * 前の面が動きの途中なら、今見えている位置（current）から動かし直す。
 */
export function selectionShift(
  from: RowPosition,
  to: RowPosition,
  current: RowPosition = { x: 0, y: 0 },
): { dx: number; dy: number } {
  return { dx: from.x + current.x - to.x, dy: from.y + current.y - to.y };
}

/**
 * 動きの途中の面が、行からまだどれだけずれて見えているか。progress は緩急を適用した進み具合（0〜1）。
 * 選択が外れた行の ::after はもう描かれないので、DOM からは読まずに、始めのずれと進み具合から求める
 */
export function remainingShift(
  shift: { dx: number; dy: number },
  progress: number | null,
): RowPosition {
  if (progress === null) return { x: 0, y: 0 };
  return { x: shift.dx * (1 - progress), y: shift.dy * (1 - progress) };
}

type Selection = {
  key: unknown;
  position: RowPosition;
  /** この行へ滑らせている動きと、その始めのずれ */
  motion: { animation: Animation; shift: { dx: number; dy: number } } | null;
};

/** 前の面の動きが途中なら、今見えているずれを返して止める */
function takeCurrentShift(previous: Selection): RowPosition {
  const motion = previous.motion;
  if (motion === null || motion.animation.playState !== 'running') return { x: 0, y: 0 };
  const shift = remainingShift(
    motion.shift,
    motion.animation.effect?.getComputedTiming().progress ?? null,
  );
  motion.animation.cancel();
  return shift;
}

/**
 * 選択（カーソル）が行から行へ移るとき、選択の面を滑らせる（FR-U01、DESIGN.md 5.2）。
 * 選択の面は行の ::after に描いてあるので、新しい行の ::after を前の行の位置から動かす。
 * 同じタスクの行が作り直されただけ（完了の欄へ移った、など）なら、行の動き（listMotion）に任せて動かさない。
 */
export function useSelectionMotion(root: RefObject<HTMLElement | null>) {
  const last = useRef<Selection | null>(null);

  useLayoutEffect(() => {
    const node = root.current?.querySelector<HTMLElement>(SELECTED_ROW) ?? null;
    if (node === null || node.offsetParent === null) {
      last.current = null;
      return;
    }
    const key = node.dataset['motionKey'] ?? node;
    const position = offsetPosition(node);
    const previous = last.current;
    if (previous?.key === key) {
      // 同じ行のまま（行が動いた、作り直された）なら、面は動かさずに位置だけ覚え直す
      last.current = { ...previous, position };
      return;
    }
    last.current = { key, position, motion: null };
    // 選んだ行が画面の外に出ないよう追従する（クリックで選んだ見えている行では、スクロールしない）
    scrollRowIntoView(node);
    if (previous === null || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const shift = selectionShift(previous.position, position, takeCurrentShift(previous));
    const t = readMotionTokens();
    const animation = node.animate(
      [{ transform: `translate(${shift.dx}px, ${shift.dy}px)` }, { transform: 'none' }],
      { duration: t.fast, easing: t.easeOut, pseudoElement: '::after', id: ANIMATION_ID },
    );
    last.current = { key, position, motion: { animation, shift } };
  });
}

/** 最後に選択の行へスクロールした時刻。キーを押しっぱなしにしたときを見分ける */
let lastScrollAt = Number.NEGATIVE_INFINITY;

/** これより短い間隔で続けて動かしたら、押しっぱなしとみなす */
const REPEAT_INTERVAL_MS = 150;

/** なめらかにスクロールするか。押しっぱなしのときと「視差効果を減らす」のときは、すぐ追従させる */
export function scrollBehaviorFor(
  now: number,
  previous: number,
  reducedMotion: boolean,
): ScrollBehavior {
  if (reducedMotion || now - previous < REPEAT_INTERVAL_MS) return 'instant';
  return 'smooth';
}

/** 選択した行が画面の外に出ないよう、必要な分だけスクロールする（DESIGN.md 5.2） */
export function scrollRowIntoView(row: HTMLElement) {
  const now = performance.now();
  const behavior = scrollBehaviorFor(
    now,
    lastScrollAt,
    matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  lastScrollAt = now;
  row.scrollIntoView({ block: 'nearest', behavior });
}
