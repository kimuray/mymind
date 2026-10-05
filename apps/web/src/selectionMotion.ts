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

/** 動きの途中の ::after の、今のずれ */
function currentShift(node: HTMLElement): RowPosition {
  const running = node
    .getAnimations({ subtree: true })
    .filter((a) => a.id === ANIMATION_ID && a.playState === 'running');
  if (running.length === 0) return { x: 0, y: 0 };
  const matrix = new DOMMatrixReadOnly(getComputedStyle(node, '::after').transform);
  for (const a of running) a.cancel();
  return { x: matrix.m41, y: matrix.m42 };
}

type Selection = { key: unknown; position: RowPosition; node: HTMLElement };

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
    last.current = { key, position, node };
    if (previous?.key === key) return;
    // 選んだ行が画面の外に出ないよう追従する（クリックで選んだ見えている行では、スクロールしない）
    scrollRowIntoView(node);
    if (previous === null || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const current = previous.node.isConnected ? currentShift(previous.node) : { x: 0, y: 0 };
    const { dx, dy } = selectionShift(previous.position, position, current);
    const t = readMotionTokens();
    node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: t.fast,
      easing: t.easeOut,
      pseudoElement: '::after',
      id: ANIMATION_ID,
    });
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
