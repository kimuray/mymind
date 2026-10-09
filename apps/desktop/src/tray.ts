import type { UpdateState } from './updater';

/** メニューバーのメニューの1項目。Electron の MenuItemConstructorOptions に渡す形 */
export type TrayItem =
  | { label: string; click: () => void }
  | { label: string; enabled: false }
  | { type: 'separator' };

/** アップデートの項目に渡すもの。.app でないとき（開発時の起動）は渡さず、項目を出さない */
export type TrayUpdate = {
  state: UpdateState;
  check: () => void;
  apply: () => void;
  openLog: () => void;
};

/** メニューバーから開ける画面（ADR-0015、DESIGN.md 3.1） */
export const TRAY_SCREENS = [
  { label: '今日', path: '/' },
  { label: '朝の計画', path: '/morning' },
  { label: '振り返り', path: '/reflection' },
] as const;

/** アップデートの状態に応じた項目（FR-U05、DESIGN.md 3.1） */
export function buildUpdateItems(update: TrayUpdate): TrayItem[] {
  const { state } = update;
  switch (state.kind) {
    case 'idle':
      return [{ label: 'アップデートを確認', click: update.check }];
    case 'checking':
      return [{ label: 'アップデートを確認しています…', enabled: false }];
    case 'available':
      return [
        { label: `アップデートがあります（${state.commits} 件の変更）…`, click: update.apply },
      ];
    case 'updating':
      return [{ label: 'アップデートしています…', enabled: false }];
    case 'failed':
      return [
        { label: 'アップデートに失敗しました（ログを開く）', click: update.openLog },
        { label: 'アップデートを確認', click: update.check },
      ];
  }
}

/**
 * メニューバーのメニュー。開く（前の画面のまま）、画面へ移る、アップデート、終了。
 * 終了するとサーバーも止まり、通知と毎日のバックアップも止まる
 */
export function buildTrayMenu(actions: {
  open: () => void;
  openPath: (path: string) => void;
  quit: () => void;
  update?: TrayUpdate;
}): TrayItem[] {
  return [
    { label: 'mymind を開く', click: actions.open },
    { type: 'separator' },
    ...TRAY_SCREENS.map((s) => ({ label: s.label, click: () => actions.openPath(s.path) })),
    { type: 'separator' },
    ...(actions.update === undefined
      ? []
      : [...buildUpdateItems(actions.update), { type: 'separator' } as const]),
    { label: 'mymind を終了', click: actions.quit },
  ];
}
