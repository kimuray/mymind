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
  | 'list.tag'
  | 'list.indent'
  | 'list.outdent'
  | 'list.moveUp'
  | 'list.moveDown'
  | 'reflection.save'
  | 'screen.submit'
  | 'decide.first'
  | 'decide.second'
  | 'decide.third'
  | 'reflection.togglePreview'
  | 'palette.open'
  | 'help.open'
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
  { action: 'palette.open', keys: ['Meta+k'], label: 'コマンドパレット' },
  { action: 'help.open', keys: ['?'], label: 'ショートカットの一覧' },
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
  { action: 'list.tag', keys: ['#'], label: 'タグを付ける（詳細ペインのタグの入力欄へ）' },
  { action: 'list.indent', keys: ['Tab'], label: '子タスクにする' },
  { action: 'list.outdent', keys: ['Shift+Tab'], label: '親に戻す' },
  { action: 'list.moveUp', keys: ['Meta+ArrowUp'], label: '上へ並べ替え' },
  { action: 'list.moveDown', keys: ['Meta+ArrowDown'], label: '下へ並べ替え' },
  // 5.3 振り返り。入力欄の中でも使えるよう、修飾キー付きにする
  // ⌘↵ はその画面の主な操作（振り返りでは保存してFBをもらう、朝の計画では計画を確定）。
  // 同じキーに画面ごとの操作を割り当てると先の定義しか選ばれないので、1つの操作にして画面が中身を決める
  {
    action: 'screen.submit',
    keys: ['Meta+Enter'],
    label: '画面の主な操作（保存してFBをもらう、計画を確定）',
  },
  { action: 'reflection.save', keys: ['Meta+s'], label: '保存のみ' },
  // 5.3 朝の計画の持ち越しと、棚卸しの判断。⌘↵ と同じく、同じキーを1つの操作にして画面が中身を決める
  {
    action: 'decide.first',
    keys: ['1'],
    label: '1つ目の判断（朝の計画：今日もやる、棚卸し：今週やる）',
  },
  {
    action: 'decide.second',
    keys: ['2'],
    label: '2つ目の判断（朝の計画：バックログへ、棚卸し：残す）',
  },
  {
    action: 'decide.third',
    keys: ['3'],
    label: '3つ目の判断（朝の計画：実は終わった、棚卸し：中止）',
  },
  // ブラウザの印刷と重なるので、振り返りの画面では印刷を止めて切り替えに使う（実機のブラウザで確認済み、#35）
  { action: 'reflection.togglePreview', keys: ['Meta+p'], label: '書く / プレビューの切り替え' },
];

/**
 * Markdown の入力欄の中だけで効くキー（DESIGN.md 5.3）。入力欄（CodeMirror）のキーマップの書き方で書く。
 * 画面の割り当て（Meta+Enter、Meta+s）と重なる入力欄の既定のキーは、入力欄の側で外す
 */
export const EDITOR_KEYS = { bold: 'Mod-b' } as const;

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

/** キーの表示（DESIGN.md 5章の表記）。Meta は ⌘、矢印は ↑↓、連続は「G → T」 */
const KEY_SYMBOLS: Readonly<Record<string, string>> = {
  Meta: '⌘',
  Shift: '⇧',
  Enter: '↵',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  ' ': 'Space',
};

export function formatKeys(keys: readonly string[]): string {
  return keys
    .map((key) =>
      key
        .split('+')
        .map((part) => KEY_SYMBOLS[part] ?? (part.length === 1 ? part.toUpperCase() : part))
        .join(''),
    )
    .join(' → ');
}

/** 操作ごとにまとめた割り当て（J と ↓ のように、1つの操作に複数のキーがあるもの） */
export type KeyCommand = { action: KeyAction; label: string; keys: string[] };

/**
 * コマンドパレットとショートカットの一覧に出す操作（ui.md：どちらもこの定義から作る）。
 * actions に含まれる（今の画面で使える）操作だけを、定義の順に並べる
 */
export function commandsFor(actions: ReadonlySet<KeyAction>): KeyCommand[] {
  const byAction = new Map<KeyAction, KeyCommand>();
  for (const b of KEY_BINDINGS) {
    if (!actions.has(b.action)) continue;
    const command = byAction.get(b.action);
    if (command === undefined) {
      byAction.set(b.action, { action: b.action, label: b.label, keys: [formatKeys(b.keys)] });
    } else {
      command.keys.push(formatKeys(b.keys));
    }
  }
  return [...byAction.values()];
}
