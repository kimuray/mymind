import { MIN_YEAR } from '@mymind/domain';
import { z } from 'zod';

/** 月（YYYY-MM）。カレンダー（FR-R04）と月次総括（FR-A06）で同じ検証を使う */
export const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM の形式で指定してください')
  .refine((ym) => Number(ym.slice(0, 4)) >= MIN_YEAR, `${MIN_YEAR}年より前の月は扱いません`);

/** 暦の上にある日か（2026-02-30 のような日を、日付の計算で翌月に繰り越させないため） */
const isCalendarDay = (day: string) => {
  const time = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === day;
};

/** 業務日（YYYY-MM-DD）。形式だけでなく、暦の上にある日かも確かめる */
export const calendarDayParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD の形式で指定してください')
  .refine(isCalendarDay, '存在しない日付です');
