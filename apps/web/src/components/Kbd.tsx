import type { ReactNode } from 'react';

/** キーボードショートカットの表示（DESIGN.md 4.5）。濃い色のボタンの中では tone="dark" にする */
export function Kbd({
  children,
  tone = 'light',
}: {
  children: ReactNode;
  tone?: 'light' | 'dark';
}) {
  return <kbd className={`kbd kbd-${tone}`}>{children}</kbd>;
}
