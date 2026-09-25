import { useEffect, useRef, useState } from 'react';
import { Button } from './components/Button';
import { currentDay, formatDayHeading } from './day';

const WATCHED = ['keydown', 'pointerdown', 'focusin'] as const;

/** サーバーが業務日の不一致（409 DAY_CHANGED）を返したときに、main.tsx が送る出来事の名前 */
export const DAY_CHANGED_EVENT = 'mymind:day-changed';

/**
 * 業務日の切り替え検知（NFR-14、architecture.md 12.4）。
 * 画面は表示している業務日を持ち、入力系の操作のたびに今の業務日と比べる。変わっていたら操作を止めて、
 * 「今日の画面へ移る」か「前の日の記録として続ける」かを選ばせる。
 */
export function useDayGuard() {
  const [day, setDay] = useState(() => currentDay());
  const [allowPastDay, setAllowPastDay] = useState(false);
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      setChangedTo(now);
    };
    // 画面の処理より先に確かめるため、捕獲の段階で受け取る
    for (const type of WATCHED) window.addEventListener(type, check, true);
    return () => {
      for (const type of WATCHED) window.removeEventListener(type, check, true);
    };
  }, [day, allowPastDay, changedTo]);

  // サーバーが 409（DAY_CHANGED）を返したときも、同じ選択を出す（画面の確認をすり抜けた場合の保険）
  useEffect(() => {
    const onServerDayChanged = () => setChangedTo(currentDay());
    window.addEventListener(DAY_CHANGED_EVENT, onServerDayChanged);
    return () => window.removeEventListener(DAY_CHANGED_EVENT, onServerDayChanged);
  }, []);

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
  return (
    <div className="dialog-backdrop">
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
