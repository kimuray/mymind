import { useEffect, useState } from 'react';

/** 「保存しました」を出しておく長さ。読み終えたら消えて、入力の邪魔をしない */
const SAVED_NOTE_MS = 2000;

/**
 * 保存できたことを短く知らせる（DESIGN.md 4.19、NFR-03）。savedAt は保存に成功した時刻（まだなら 0）。
 * 読み上げのために要素は残し、文を出し入れする
 */
export function SavedNote({ savedAt }: { savedAt: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (savedAt === 0) return;
    setShown(true);
    const timer = setTimeout(() => setShown(false), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);
  return (
    <p className="saved-note text-small" role="status" data-shown={shown}>
      {shown ? '保存しました' : ''}
    </p>
  );
}
