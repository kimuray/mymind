import { type RefObject, useLayoutEffect, useRef } from 'react';

/** 行の位置。リストを包む要素の左上からの距離（スクロールしても変わらない） */
export type RowPosition = { x: number; y: number };

/**
 * 動かす要素の位置と、入れ子の親（同じく data-motion-key の付いた、いちばん近い祖先）。
 * リストの面とその中の行のように入れ子にしたとき、子は親が動いた分を差し引いて動かす
 */
export type MotionItem = RowPosition & { parent?: string | null };

export type ListMotionPlan = {
  /** 位置が変わった行と、新しい位置から見た元の位置へのずれ（入れ子なら親のずれを差し引いた分） */
  moves: { key: string; dx: number; dy: number }[];
  /** 新しく現れた行（親と一緒に現れた子は含めない） */
  enters: string[];
  /** なくなった行（親と一緒に消えた子は含めない） */
  exits: string[];
};

/** これより小さいずれは動かさない（小数の丸めで毎回動かないように） */
const MOVE_THRESHOLD_PX = 0.5;

/**
 * 前と今の行の位置から、どの行をどう動かすかを決める（DESIGN.md 4.18）。
 * 欄をまたいで移った行（完了の欄へ、など）も、同じ key なら位置の移動として扱う。
 * 入れ子の子は、親の動き（親が描き直されるときに一緒に動く）を差し引いて二重に動かさない
 */
export function planListMotion(
  previous: ReadonlyMap<string, MotionItem>,
  next: ReadonlyMap<string, MotionItem>,
): ListMotionPlan {
  const totalShift = (key: string | null | undefined) => {
    if (key === null || key === undefined) return { dx: 0, dy: 0 };
    const from = previous.get(key);
    const to = next.get(key);
    if (from === undefined || to === undefined) return { dx: 0, dy: 0 };
    return { dx: from.x - to.x, dy: from.y - to.y };
  };
  const moves: ListMotionPlan['moves'] = [];
  const enters: string[] = [];
  for (const [key, to] of next) {
    if (!previous.has(key)) {
      const parent = to.parent;
      if (parent === null || parent === undefined || previous.has(parent)) enters.push(key);
      continue;
    }
    const own = totalShift(key);
    const parent = totalShift(to.parent);
    const dx = own.dx - parent.dx;
    const dy = own.dy - parent.dy;
    if (Math.abs(dx) >= MOVE_THRESHOLD_PX || Math.abs(dy) >= MOVE_THRESHOLD_PX) {
      moves.push({ key, dx, dy });
    }
  }
  const exits = [...previous]
    .filter(([key, item]) => {
      if (next.has(key)) return false;
      const parent = item.parent;
      return parent === null || parent === undefined || next.has(parent);
    })
    .map(([key]) => key);
  if (isLayoutShiftOnly(next, moves, enters, exits)) return { moves: [], enters, exits };
  return { moves, enters, exits };
}

/**
 * 行の出入りがなく、外側の要素がすべて同じだけずれただけか。
 * 見出しのフォントの読み込みなどで、測る範囲の上にあるものの高さが変わっただけなので、行の移動として動かさない
 * （画面を開いた直後に全体が動いて見えないように）
 */
function isLayoutShiftOnly(
  next: ReadonlyMap<string, MotionItem>,
  moves: ListMotionPlan['moves'],
  enters: readonly string[],
  exits: readonly string[],
): boolean {
  if (moves.length === 0 || enters.length > 0 || exits.length > 0) return false;
  const roots = [...next].filter(([, item]) => item.parent === null || item.parent === undefined);
  if (roots.length === 0 || moves.length !== roots.length) return false;
  const first = moves[0];
  if (first === undefined) return false;
  const rootKeys = new Set(roots.map(([key]) => key));
  return moves.every(
    (m) =>
      rootKeys.has(m.key) &&
      Math.abs(m.dx - first.dx) < MOVE_THRESHOLD_PX &&
      Math.abs(m.dy - first.dy) < MOVE_THRESHOLD_PX,
  );
}

/**
 * 消える要素（exitKey）の中にあって、次の描画にも残る子孫の key。
 * 最後の完了タスクを未完了へ戻すと「完了」の面は消えるが、その行は別の面へ移って残るので、
 * 面の写しからその行を隠し、同じタスクが二重に見えないようにする
 */
export function survivingDescendants(
  previous: ReadonlyMap<string, MotionItem>,
  next: ReadonlyMap<string, MotionItem>,
  exitKey: string,
): string[] {
  const isInside = (key: string) => {
    let parent = previous.get(key)?.parent;
    while (parent !== null && parent !== undefined) {
      if (parent === exitKey) return true;
      parent = previous.get(parent)?.parent;
    }
    return false;
  };
  return [...previous.keys()].filter((key) => next.has(key) && isInside(key));
}

/** CSS 変数の時間（"200ms"、"0.2s"）をミリ秒にする */
export function parseDuration(value: string): number {
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) return 0;
  return value.trim().endsWith('ms') ? n : n * 1000;
}

/** 動きのトークン（DESIGN.md 2.7）。値を直書きしないよう、tokens.css から読む */
export function readMotionTokens() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    fast: parseDuration(read('--motion-fast')),
    base: parseDuration(read('--motion-base')),
    easeOut: read('--ease-out') || 'ease-out',
    easeInOut: read('--ease-in-out') || 'ease-in-out',
  };
}

/** この部品が付けた動きの印。ほかの動き（CSS のもの）と区別して、測る前に止める */
const ANIMATION_ID = 'list-motion';

/**
 * 読み込み中を経て中身が出たときのフェードインの印（DESIGN.md 4.19）。行の移動（ANIMATION_ID）とは分け、
 * 開いたときの動きを行の移動と取り違えないようにする（issue 247）
 */
const FADE_IN_ID = 'list-fade-in';

/** 文書の左上からの位置。offset の連なりで測るので、transform（動きの途中のずれ）を含まない */
export function offsetPosition(el: HTMLElement): RowPosition {
  let x = 0;
  let y = 0;
  let current: Element | null = el;
  while (current instanceof HTMLElement) {
    x += current.offsetLeft;
    y += current.offsetTop;
    current = current.offsetParent;
  }
  return { x, y };
}

type Snapshot = {
  position: RowPosition;
  /** 入れ子の親の key（なければ null） */
  parent: string | null;
  node: HTMLElement;
  size: { w: number; h: number };
};

/** いちばん近い、data-motion-key の付いた祖先（container の中だけ） */
function motionParent(el: HTMLElement, container: HTMLElement): string | null {
  const parent = el.parentElement?.closest<HTMLElement>('[data-motion-key]');
  if (parent === null || parent === undefined || !container.contains(parent)) return null;
  return parent.dataset['motionKey'] ?? null;
}

const isVisible = (top: number, height: number) => top + height > 0 && top < window.innerHeight;

/**
 * なくなった行の写しを、元の場所に重ねて消す。React が外した要素を、画面の外側の層に移して使う。
 * hidden は写しの中で隠す子孫の key（別の場所へ移って残る行）
 */
function playExit(
  node: HTMLElement,
  left: number,
  top: number,
  size: Snapshot['size'],
  hidden: readonly string[],
) {
  const t = readMotionTokens();
  const ghost = node;
  for (const el of ghost.querySelectorAll<HTMLElement>('[data-motion-key]')) {
    const key = el.dataset['motionKey'];
    if (key !== undefined && hidden.includes(key)) el.style.visibility = 'hidden';
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('list-motion-ghost');
  // 位置と大きさは行ごとに違うので CSSOM で与える（CSP は style 属性を許さないが、CSSOM は許す）
  ghost.style.left = `${left}px`;
  ghost.style.top = `${top}px`;
  ghost.style.width = `${size.w}px`;
  ghost.style.height = `${size.h}px`;
  document.body.append(ghost);
  const animation = ghost.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateX(24px)' },
    ],
    { duration: t.fast, easing: t.easeOut, id: ANIMATION_ID },
  );
  const remove = () => ghost.remove();
  animation.addEventListener('finish', remove);
  animation.addEventListener('cancel', remove);
}

/**
 * リストの行の追加・移動・並べ替えを、目で追える動きにする（FR-U01、DESIGN.md 4.18）。
 * 描画のたびに `data-motion-key` の付いた行の位置を測り、前と比べて FLIP で動かす。
 * 動かすのは transform と opacity だけで、入力は止めない。
 * `ready` が false のあいだ（読み込み中）と、初めて ready になったときは動かさない（画面を開いたときに全行が動かないように）。
 * `scope` が変わったとき（詳細ペインで別のタスクを選んだ、など）も、中身が入れ替わっただけなので動かさない。
 */
export function useListMotion(
  root: RefObject<HTMLElement | null>,
  ready: boolean,
  scope: string | null = null,
) {
  const previous = useRef<Map<string, Snapshot> | null>(null);
  const previousScope = useRef(scope);
  // 読み込み中を経てから中身が出たか。出たときは、急に現れないようフェードインさせる（DESIGN.md 4.19）
  const wasLoading = useRef(false);

  useLayoutEffect(() => {
    const container = root.current;
    if (container === null || !ready) {
      previous.current = null;
      if (container !== null) wasLoading.current = true;
      return;
    }
    const origin = container.getBoundingClientRect();
    const base = offsetPosition(container);
    const next = new Map<string, Snapshot>();
    for (const el of container.querySelectorAll<HTMLElement>('[data-motion-key]')) {
      const key = el.dataset['motionKey'];
      if (key === undefined || el.offsetParent === null) continue;
      // 位置は transform を含まない offset で測る。動きの途中でも、行の本来の位置が分かる
      const o = offsetPosition(el);
      next.set(key, {
        position: { x: o.x - base.x, y: o.y - base.y },
        parent: motionParent(el, container),
        node: el,
        size: { w: el.offsetWidth, h: el.offsetHeight },
      });
    }

    const before = previous.current;
    previous.current = next;
    const sameScope = previousScope.current === scope;
    previousScope.current = scope;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (before === null) {
      // 画面を開いたときは動かさない。ただし読み込み中を経たときは、外側の要素だけを短くフェードインさせる
      if (wasLoading.current && !reduced) {
        const t = readMotionTokens();
        for (const snap of next.values()) {
          if (snap.parent !== null) continue;
          snap.node.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: t.base,
            easing: t.easeOut,
            id: FADE_IN_ID,
          });
        }
      }
      wasLoading.current = false;
      return;
    }
    if (!sameScope || reduced) return;

    const positions = (snapshots: Map<string, Snapshot>) =>
      new Map<string, MotionItem>(
        [...snapshots].map(([key, snap]) => [key, { ...snap.position, parent: snap.parent }]),
      );
    // 今見えている位置と本来の位置のずれ（動きの途中なら transform の分）
    const visualOffset = (snap: Snapshot): RowPosition => {
      const r = snap.node.getBoundingClientRect();
      return { x: r.left - origin.left - snap.position.x, y: r.top - origin.top - snap.position.y };
    };
    // 本来の位置が変わらない行は、動きの途中でもそのままにする（再描画のたびに動かし直さない）
    const plan = planListMotion(positions(before), positions(next));
    if (plan.moves.length === 0 && plan.enters.length === 0 && plan.exits.length === 0) return;

    const t = readMotionTokens();
    for (const { key, dx, dy } of plan.moves) {
      const snap = next.get(key);
      if (snap === undefined) continue;
      // 前後どちらも画面の外なら動かさない（長いリストでも重くしない）
      const top = origin.top + snap.position.y;
      if (!isVisible(top, snap.size.h) && !isVisible(top + dy, snap.size.h)) continue;
      // 動きの途中で行き先が変わったら、今見えている位置から動かし直す
      const running = snap.node.getAnimations().filter((a) => a.id === ANIMATION_ID);
      let shift = { dx, dy };
      if (running.length > 0) {
        // 入れ子なら、親が今ずれて見えている分は親の動きに任せる
        const own = visualOffset(snap);
        const parent = snap.parent === null ? undefined : next.get(snap.parent);
        const inherited = parent === undefined ? { x: 0, y: 0 } : visualOffset(parent);
        shift = { dx: own.x - inherited.x, dy: own.y - inherited.y };
        for (const a of running) a.cancel();
      }
      snap.node.animate(
        [{ transform: `translate(${shift.dx}px, ${shift.dy}px)` }, { transform: 'none' }],
        { duration: t.base, easing: t.easeInOut, id: ANIMATION_ID },
      );
    }
    for (const key of plan.enters) {
      const snap = next.get(key);
      if (snap === undefined || !isVisible(origin.top + snap.position.y, snap.size.h)) continue;
      snap.node.animate(
        [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: t.base, easing: t.easeOut, id: ANIMATION_ID },
      );
    }
    for (const key of plan.exits) {
      const snap = before.get(key);
      // React が外した要素だけを使う（まだ画面にある要素は動かさない）
      if (snap === undefined || snap.node.isConnected) continue;
      const left = origin.left + snap.position.x;
      const top = origin.top + snap.position.y;
      if (!isVisible(top, snap.size.h)) continue;
      playExit(
        snap.node,
        left,
        top,
        snap.size,
        survivingDescendants(positions(before), positions(next), key),
      );
    }
  });
}
