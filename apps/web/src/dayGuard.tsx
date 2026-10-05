import { useEffect, useRef, useState } from 'react';
import { Button } from './components/Button';
import { currentDay, formatDayHeading } from './day';
import { useDialogExit } from './dialogMotion';

const WATCHED = ['keydown', 'pointerdown', 'focusin'] as const;

/** サーバーが業務日の不一致（409 DAY_CHANGED）を返したときに、main.tsx が送る出来事の名前 */
export const DAY_CHANGED_EVENT = 'mymind:day-changed';

/** 今フォーカスのある要素（なければ null）。ダイアログを閉じたら、ここへ戻す */
function focusedElement(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * 業務日の切り替え検知（NFR-14、architecture.md 12.4）。
 * 画面は表示している業務日を持ち、入力系の操作のたびに今の業務日と比べる。変わっていたら操作を止めて、
 * 「今日の画面へ移る」か「前の日の記録として続ける」かを選ばせる。
 * 日付を指定して開いた画面（過去の日の振り返りなど）では enabled を false にして、確かめない。
 */
export function useDayGuard(enabled = true) {
  const [day, setDay] = useState(() => currentDay());
  const [allowPastDay, setAllowPastDay] = useState(false);
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // ダイアログを閉じたら、開く前にフォーカスがあった場所へ戻す（DESIGN.md 4.9、NFR-06）
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const check = (e: Event) => {
      // 前の日として続けると決めたあとと、ダイアログの中の操作は止めない
      if (allowPastDay || changedTo !== null) {
        if (changedTo !== null && !dialogRef.current?.contains(e.target as Node)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      const now = currentDay();
      if (now === day) return;
      if (e.type !== 'focusin') {
        e.preventDefault();
        e.stopPropagation();
      }
      // focusin のあいだは activeElement がまだ前の要素なので、フォーカスを受けようとした要素を覚える。
      // ダイアログの既定のボタンへフォーカスが移るときも、古い状態のままここへ来るので、最初の要素を保つ
      returnFocus.current ??=
        e.type === 'focusin' && e.target instanceof HTMLElement ? e.target : focusedElement();
      setChangedTo(now);
    };
    // 画面の処理より先に確かめるため、捕獲の段階で受け取る
    for (const type of WATCHED) window.addEventListener(type, check, true);
    return () => {
      for (const type of WATCHED) window.removeEventListener(type, check, true);
    };
  }, [enabled, day, allowPastDay, changedTo]);

  // サーバーが 409（DAY_CHANGED）を返したときも、同じ選択を出す（画面の確認をすり抜けた場合の保険）
  useEffect(() => {
    if (!enabled) return;
    const onServerDayChanged = () => {
      returnFocus.current ??= focusedElement();
      setChangedTo(currentDay());
    };
    window.addEventListener(DAY_CHANGED_EVENT, onServerDayChanged);
    return () => window.removeEventListener(DAY_CHANGED_EVENT, onServerDayChanged);
  }, [enabled]);

  // 閉じたあと（ダイアログが外れてから）、覚えておいた場所へフォーカスを戻す
  useEffect(() => {
    if (changedTo !== null) return;
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus();
  }, [changedTo]);

  const dialog =
    changedTo === null ? null : (
      <DayChangedDialog
        ref={dialogRef}
        screenDay={day}
        today={changedTo}
        onMoveToToday={() => {
          setDay(changedTo);
          setAllowPastDay(false);
          setChangedTo(null);
        }}
        onContinue={() => {
          setAllowPastDay(true);
          setChangedTo(null);
        }}
      />
    );

  return { day, allowPastDay, dialog };
}

type DialogProps = {
  ref: React.Ref<HTMLDivElement>;
  screenDay: string;
  today: string;
  onMoveToToday: () => void;
  onContinue: () => void;
};

/** 業務日が変わったことを知らせるダイアログ。既定は「今日の画面へ移る」 */
function DayChangedDialog({ ref, screenDay, today, onMoveToToday, onContinue }: DialogProps) {
  const past = formatDayHeading(screenDay).date;
  const now = formatDayHeading(today).date;
  // 閉じたとき、写しを消して閉じる動きにする（DESIGN.md 4.9）
  const backdrop = useRef<HTMLDivElement>(null);
  useDialogExit(backdrop);
  return (
    <div ref={backdrop} className="dialog-backdrop">
      <div
        ref={ref}
        className="dialog glass-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="day-changed-title"
        aria-describedby="day-changed-text"
      >
        <h2 id="day-changed-title" className="text-title">
          日付が変わりました
        </h2>
        <p id="day-changed-text">
          {`この画面は${past}のままです。今日（${now}）の画面へ移るか、${past}の記録として続けるかを選んでください。`}
        </p>
        <div className="dialog-actions">
          {/* biome-ignore lint/a11y/noAutofocus: ダイアログを開いたら既定の操作にフォーカスを置く */}
          <Button kind="primary" autoFocus onClick={onMoveToToday}>
            今日の画面へ移る
          </Button>
          <Button onClick={onContinue}>{`前の日（${past}）の記録として続ける`}</Button>
        </div>
      </div>
    </div>
  );
}
