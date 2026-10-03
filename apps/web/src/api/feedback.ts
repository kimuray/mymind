import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { queryKeys } from './tasks';

/** 生成中のジョブを止める（FR-A08、POST /api/jobs/:id/cancel） */
export function useCancelJob(day: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) =>
      unwrap(await api.jobs[':id'].cancel.$post({ param: { id: jobId } })),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.day(day) }),
  });
}

/** 調子を手で直す（FR-A03、PUT /api/days/:day/condition）。null で AI の判定に戻す */
export function useSetCondition(day: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userLevel: number | null) =>
      unwrap(await api.days[':day'].condition.$put({ param: { day }, json: { userLevel } })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['day'] }),
  });
}
