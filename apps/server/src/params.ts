import { MIN_YEAR } from '@mymind/domain';
import { z } from 'zod';

/** 月（YYYY-MM）。カレンダー（FR-R04）と月次総括（FR-A06）で同じ検証を使う */
export const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM の形式で指定してください')
  .refine((ym) => Number(ym.slice(0, 4)) >= MIN_YEAR, `${MIN_YEAR}年より前の月は扱いません`);
