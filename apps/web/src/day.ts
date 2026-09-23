import { type BusinessDayOptions, toBusinessDay } from '@mymind/domain';

// 業務日の切り替え（FR-D01）。設定を読む API ができるまでは初期値を使う（サーバーと同じ値）
export const DAY_OPTIONS: BusinessDayOptions = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };

/** 今の業務日（YYYY-MM-DD） */
export const currentDay = (now: Date = new Date()) => toBusinessDay(now, DAY_OPTIONS);

/** ISO の時刻を業務日にする */
export const dayOf = (iso: string) => toBusinessDay(new Date(iso), DAY_OPTIONS);

const WEEKDAYS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'] as const;

/** 画面の見出しの日付（「9月22日」と「火曜日」） */
export function formatDayHeading(day: string): { date: string; weekday: string } {
  const [y, m, d] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  return { date: `${m}月${d}日`, weekday: WEEKDAYS[utc.getUTCDay()] ?? '' };
}

/** 履歴に出す短い日付（「9/22」） */
export const formatShortDay = (day: string) => {
  const [, m, d] = day.split('-').map(Number);
  return `${m}/${d}`;
};
