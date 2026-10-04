import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { AgentChoice } from './settings';

/** カレンダーの月（GET /api/months/:ym、FR-R04） */
const fetchMonth = async (ym: string) => unwrap(await api.months[':ym'].$get({ param: { ym } }));

export type MonthResponse = Awaited<ReturnType<typeof fetchMonth>>;
export type MonthDay = MonthResponse['days'][number];

export const monthKey = (ym: string) => ['month', ym] as const;

export function useMonth(ym: string) {
  return useQuery({ queryKey: monthKey(ym), queryFn: () => fetchMonth(ym) });
}

export type MonthSummary = NonNullable<MonthResponse['summary']>;
export type MonthSummaryJob = NonNullable<MonthResponse['summaryJob']>;

/**
 * 送信内容を確かめずに月次総括を依頼する（FR-A06）。月の途中なら途中経過になる（サーバーが決める）。
 * エージェントを省くと、サーバーが設定の既定のエージェントを使う
 */
export function useRequestMonthlySummary(ym: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agent?: AgentChoice) =>
      unwrap(
        await api.jobs.$post({
          json: { kind: 'monthly_summary', period: ym, ...(agent && { agent }) },
        }),
      ),
    // 依頼したジョブを、すぐに生成中として出す（進み具合は SSE で読み直す）
    onSettled: () => qc.invalidateQueries({ queryKey: monthKey(ym) }),
  });
}

/** 生成中の月次総括を止める（FR-A08） */
export function useCancelMonthlySummary(ym: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) =>
      unwrap(await api.jobs[':id'].cancel.$post({ param: { id: jobId } })),
    onSettled: () => qc.invalidateQueries({ queryKey: monthKey(ym) }),
  });
}
