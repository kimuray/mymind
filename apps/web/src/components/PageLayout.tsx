import type { ReactNode } from 'react';

/**
 * 3ペインのうち、メインと詳細ペイン（DESIGN.md 3章）。サイドバーは AppShell が置く。
 * 詳細ペインは、1280px 未満では選択中のときだけ右から重ねて出す。
 */
export function PageLayout({ children, detail }: { children: ReactNode; detail?: ReactNode }) {
  return (
    <>
      <main className="pane pane-main">{children}</main>
      <aside
        className="pane pane-detail glass-3"
        aria-label="詳細"
        data-open={detail === undefined ? 'false' : 'true'}
      >
        {detail ?? <p className="empty-note">項目を選ぶと、ここに詳細が表示されます</p>}
      </aside>
    </>
  );
}
