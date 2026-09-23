import type { ReactNode } from 'react';

/** キーボードショートカットの表示（DESIGN.md 4.5）。濃い色のボタンの中で使う形は、ボタンを作る issue で加える */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd kbd-light">{children}</kbd>;
}
