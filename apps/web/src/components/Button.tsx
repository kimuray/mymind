import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'confirm' | 'secondary' | 'text';
  /** 押した操作を処理しているあいだ true。押せなくし、処理中であることを見た目と読み上げで示す（DESIGN.md 4.19） */
  busy?: boolean;
  children: ReactNode;
};

/** ボタン（DESIGN.md 4.4）。主ボタンは1画面に1つ */
export function Button({
  kind = 'secondary',
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`button button-${kind} ${className ?? ''}`}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
