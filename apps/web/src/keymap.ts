// キーの割り当ての定義（DESIGN.md 5章、ui.md）。コマンドパレットとショートカットの一覧はここから作る。
// 割り当てを変えたら DESIGN.md のキーマップ表も同時に更新する。

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

export type KeyAction =
  | `nav.${NavigationTarget}`
  | 'task.new'
  | 'list.next'
  | 'list.prev'
  | 'list.advance'
  | 'list.pause'
  | 'list.wait'
  | 'list.cancel'
  | 'list.dayKey'
  | 'list.toBacklog'
  | 'list.edit'
  | 'list.indent'
  | 'list.outdent'
  | 'list.moveUp'
  | 'list.moveDown'
  | 'escape';

/**
 * 1つの割り当て。keys は押す順（G → T のような連続も表す）。
 * 各キーは KeyboardEvent.key の値で、修飾キーは「Meta+」「Shift+」を前に付ける。
 */
export type KeyBinding = { action: KeyAction; keys: readonly string[]; label: string };

const nav = (target: NavigationTarget, label: string): KeyBinding => ({
  action: `nav.${target}`,
  keys: NAVIGATION_KEYS[target].map((k) => k.toLowerCase()),
  label,
});

export const KEY_BINDINGS: readonly KeyBinding[] = [
  // 5.1 どの画面でも使えるキー
  { action: 'task.new', keys: ['n'], label: 'タスクを追加（入力欄へ移動）' },
  nav('today', '今日'),
  nav('morning', '朝の計画'),
  nav('reflection', '振り返り'),
  nav('backlog', 'バックログ'),
  nav('timeline', 'タイムライン'),
  nav('calendar', 'カレンダー'),
  { action: 'escape', keys: ['Escape'], label: '選択の解除、パネルを閉じる' },
  // 5.2 タスクのリスト
  { action: 'list.next', keys: ['j'], label: '次のタスク' },
  { action: 'list.next', keys: ['ArrowDown'], label: '次のタスク' },
  { action: 'list.prev', keys: ['k'], label: '前のタスク' },
  { action: 'list.prev', keys: ['ArrowUp'], label: '前のタスク' },
  { action: 'list.advance', keys: [' '], label: '状態を進める' },
  { action: 'list.advance', keys: ['Enter'], label: '状態を進める' },
  { action: 'list.pause', keys: ['p'], label: '中断' },
  { action: 'list.wait', keys: ['w'], label: '待ち' },
  { action: 'list.cancel', keys: ['x'], label: '中止' },
  { action: 'list.dayKey', keys: ['t'], label: '今日のリストでは明日へ、バックログでは今日へ' },
  { action: 'list.toBacklog', keys: ['b'], label: 'バックログへ' },
  { action: 'list.edit', keys: ['e'], label: 'タイトルを編集' },
  { action: 'list.indent', keys: ['Tab'], label: '子タスクにする' },
  { action: 'list.outdent', keys: ['Shift+Tab'], label: '親に戻す' },
  { action: 'list.moveUp', keys: ['Meta+ArrowUp'], label: '上へ並べ替え' },
  { action: 'list.moveDown', keys: ['Meta+ArrowDown'], label: '下へ並べ替え' },
];

/** サイドバーの下に案内するショートカット */
export const SIDEBAR_HINTS: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'コマンド', keys: ['⌘K'] },
  { label: '新しいタスク', keys: ['N'] },
];

/** タスクのリストの下に案内するキー（DESIGN.md 5.2） */
export const LIST_HINTS: readonly string[] = [
  'J K 移動',
  'Space 状態を進める',
  'P 中断 / W 待ち',
  'T 明日へ / B バックログへ',
  '⌘K コマンド',
];
