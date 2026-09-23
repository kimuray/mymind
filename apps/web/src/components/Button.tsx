import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'text';
  children: ReactNode;
};

/** ボタン（DESIGN.md 4.4）。主ボタンは1画面に1つ */
export function Button({ kind = 'secondary', className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`button button-${kind} ${className ?? ''}`} {...rest}>
      {children}
    </button>
  );
}
