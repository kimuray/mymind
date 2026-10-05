/** メニューバーのメニューの1項目。Electron の MenuItemConstructorOptions に渡す形 */
export type TrayItem = { label: string; click: () => void } | { type: 'separator' };

/** メニューバーから開ける画面（ADR-0015、DESIGN.md 3.1） */
export const TRAY_SCREENS = [
  { label: '今日', path: '/' },
  { label: '朝の計画', path: '/morning' },
  { label: '振り返り', path: '/reflection' },
] as const;

/**
 * メニューバーのメニュー。開く（前の画面のまま）、画面へ移る、終了。
 * 終了するとサーバーも止まり、通知と毎日のバックアップも止まる
 */
export function buildTrayMenu(actions: {
  open: () => void;
  openPath: (path: string) => void;
  quit: () => void;
}): TrayItem[] {
  return [
    { label: 'mymind を開く', click: actions.open },
    { type: 'separator' },
    ...TRAY_SCREENS.map((s) => ({ label: s.label, click: () => actions.openPath(s.path) })),
    { type: 'separator' },
    { label: 'mymind を終了', click: actions.quit },
  ];
}
