// キーの割り当ての定義（DESIGN.md 5章、ui.md）。コマンドパレットとショートカットの一覧はここから作る。
// キーの処理そのものは #31（タスクリストのキーボード操作）で実装する。

export type NavigationTarget =
  | 'today'
  | 'morning'
  | 'reflection'
  | 'backlog'
  | 'timeline'
  | 'calendar';

/** 画面の移動（G → 各キー） */
export const NAVIGATION_KEYS: Readonly<Record<NavigationTarget, readonly string[]>> = {
  today: ['G', 'T'],
  morning: ['G', 'M'],
  reflection: ['G', 'R'],
  backlog: ['G', 'B'],
  timeline: ['G', 'L'],
  calendar: ['G', 'C'],
};

/** サイドバーの下に案内するショートカット */
export const SIDEBAR_HINTS: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'コマンド', keys: ['⌘K'] },
  { label: '新しいタスク', keys: ['N'] },
];

/** タスクのリストの下に案内するキー（DESIGN.md 5.2。処理は #31） */
export const LIST_HINTS: readonly string[] = [
  'J K 移動',
  'Space 状態を進める',
  'P 中断 / W 待ち',
  'T 明日へ / B バックログへ',
  '⌘K コマンド',
];
