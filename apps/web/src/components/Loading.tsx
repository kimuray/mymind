import { useEffect, useState } from 'react';

/** これより早く読み込めたら、読み込み中の表示を出さない（一瞬だけ出てちらつかないように） */
const LOADING_DELAY_MS = 200;

/**
 * 読み込み中の表示（DESIGN.md 4.19、NFR-03）。読み込みが長いときだけ、控えめに点滅する文を出す。
 * ローカルのサーバーはふつう速く応えるので、ほとんどの場合は何も出さない
 */
export function Loading({ label = '読み込んでいます…' }: { label?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <p className="loading-note" role="status">
      {shown ? label : ''}
    </p>
  );
}
