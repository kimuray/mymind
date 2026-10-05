/**
 * アプリのメニュー（DESIGN.md 3.1、FR-U01）。Electron の MenuItemConstructorOptions に渡す形。
 * 画面のショートカット（DESIGN.md 5章、apps/web/src/keymap.ts）と重ならないキーだけを使う。
 * macOS ではメニューのキーが画面より先に効くので、重なると画面の操作が動かなくなるため
 */
export type AppMenuItem =
  | { label: string; submenu: AppMenuItem[] }
  | { role: AppMenuRole; label?: string; accelerator?: string }
  | { type: 'separator' };

export type AppMenuRole =
  | 'about'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'togglefullscreen'
  | 'reload'
  | 'toggleDevTools'
  | 'minimize'
  | 'close'
  | 'front';

const separator = { type: 'separator' } as const;

/**
 * メニューを組み立てる。キーは Electron の既定と同じものを明示し、テストで画面のキーと突き合わせる。
 * 読み直しと開発者ツールは開発時だけ（`.app` で読み直すと、書きかけの振り返りの入力が消えて見えるため）
 */
export function buildAppMenu(options: { isDev: boolean }): AppMenuItem[] {
  return [
    {
      label: 'mymind',
      submenu: [
        { role: 'about', label: 'mymind について' },
        separator,
        { role: 'hide', label: 'mymind を隠す', accelerator: 'Command+H' },
        { role: 'hideOthers', label: 'ほかを隠す', accelerator: 'Command+Alt+H' },
        { role: 'unhide', label: 'すべてを表示' },
        separator,
        { role: 'quit', label: 'mymind を終了', accelerator: 'Command+Q' },
      ],
    },
    {
      label: '編集',
      submenu: [
        { role: 'undo', label: '取り消す', accelerator: 'Command+Z' },
        { role: 'redo', label: 'やり直す', accelerator: 'Shift+Command+Z' },
        separator,
        { role: 'cut', label: '切り取り', accelerator: 'Command+X' },
        { role: 'copy', label: 'コピー', accelerator: 'Command+C' },
        { role: 'paste', label: '貼り付け', accelerator: 'Command+V' },
        { role: 'selectAll', label: 'すべてを選択', accelerator: 'Command+A' },
      ],
    },
    {
      label: '表示',
      submenu: [
        { role: 'resetZoom', label: '実際の大きさ', accelerator: 'Command+0' },
        { role: 'zoomIn', label: '拡大', accelerator: 'Command+Plus' },
        { role: 'zoomOut', label: '縮小', accelerator: 'Command+-' },
        separator,
        { role: 'togglefullscreen', label: 'フルスクリーン', accelerator: 'Control+Command+F' },
        ...(options.isDev
          ? [
              separator,
              { role: 'reload', label: '読み直す（開発用）', accelerator: 'Command+R' } as const,
              {
                role: 'toggleDevTools',
                label: '開発者ツール（開発用）',
                accelerator: 'Alt+Command+I',
              } as const,
            ]
          : []),
      ],
    },
    {
      label: 'ウィンドウ',
      submenu: [
        { role: 'minimize', label: 'しまう', accelerator: 'Command+M' },
        { role: 'close', label: '閉じる', accelerator: 'Command+W' },
        separator,
        { role: 'front', label: 'すべてを手前に' },
      ],
    },
  ];
}

/** メニューのすべてのキー（Electron の書き方。例：「Command+Q」） */
export function menuAccelerators(items: readonly AppMenuItem[]): string[] {
  return items.flatMap((item) => {
    if ('submenu' in item) return menuAccelerators(item.submenu);
    if ('accelerator' in item && item.accelerator !== undefined) return [item.accelerator];
    return [];
  });
}

/**
 * Electron のキーの書き方（「Shift+Command+Z」）を、画面のキーマップの書き方（「Meta+Shift+z」）にそろえる。
 * 修飾キーの順を決め、文字は小文字にする
 */
export function toKeymapNotation(accelerator: string): string {
  const parts = accelerator.split('+');
  // 「Command+Plus」のように、キーとしての + は名前で書く
  const key = parts.at(-1) ?? '';
  const mods = new Set(
    parts.slice(0, -1).map((m) => (m === 'Command' || m === 'CmdOrCtrl' ? 'Meta' : m)),
  );
  const order = ['Meta', 'Control', 'Alt', 'Shift'].filter((m) => mods.has(m));
  const normalizedKey = key === 'Plus' ? '+' : key.length === 1 ? key.toLowerCase() : key;
  return [...order, normalizedKey].join('+');
}
