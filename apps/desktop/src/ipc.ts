/** 画面とメインプロセスの間のチャンネル名（preload と main で同じ名前を使う） */
export const IPC = {
  getLoginItem: 'mymind:login-item:get',
  setLoginItem: 'mymind:login-item:set',
} as const;

/** ログイン時の起動の状態。available が false なら、開発時の起動などで切り替えられない */
export type LoginItemState = { available: boolean; enabled: boolean };
