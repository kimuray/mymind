import type { ReactNode } from 'react';
import { useRef } from 'react';
import { useDetailSwap } from '../detailMotion';

/**
 * 3ペインのうち、メインと詳細ペイン（DESIGN.md 3章）。サイドバーは AppShell が置く。
 * 詳細ペインは、1280px 未満では選択中のときだけ右から重ねて出す。
 */
export function PageLayout({
  children,
  detail,
  detailKey,
  detailLoading = false,
  emptyNote = '項目を選ぶと、ここに詳細が表示されます',
}: {
  children: ReactNode;
  detail?: ReactNode;
  /** 詳細に出している項目の識別子。変わったら中身の入れ替えに動きを付ける（省くと、出ているかどうかだけで判断する） */
  detailKey?: string | null;
  /** 詳細の元のデータを読み込んでいるか。読み込みが終わって中身が出たときは動かさない */
  detailLoading?: boolean;
  /** 詳細がないときに出す案内 */
  emptyNote?: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  useDetailSwap(
    content,
    detail === undefined ? null : detailKey === undefined ? 'detail' : detailKey,
    detailLoading,
  );
  return (
    <>
      <main className="pane pane-main">{children}</main>
      <aside
        className="pane pane-detail neu-raised-2"
        aria-label="詳細"
        data-open={detail === undefined ? 'false' : 'true'}
      >
        <div ref={content} className="pane-detail-content">
          {detail ?? <p className="empty-note">{emptyNote}</p>}
        </div>
      </aside>
    </>
  );
}
