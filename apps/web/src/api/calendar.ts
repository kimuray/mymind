import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';

/** カレンダーの月（GET /api/months/:ym、FR-R04） */
const fetchMonth = async (ym: string) => unwrap(await api.months[':ym'].$get({ param: { ym } }));

export type MonthResponse = Awaited<ReturnType<typeof fetchMonth>>;
export type MonthDay = MonthResponse['days'][number];

export const monthKey = (ym: string) => ['month', ym] as const;

export function useMonth(ym: string) {
  return useQuery({ queryKey: monthKey(ym), queryFn: () => fetchMonth(ym) });
}
