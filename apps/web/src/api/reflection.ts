import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { queryKeys } from './tasks';

export type ReflectionDraft = { thoughtsMd: string; learningMd: string };

/** 振り返りを保存する（FR-D06、FR-D08、PUT /api/days/:day/log） */
export function useSaveReflection(day: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: ReflectionDraft) =>
      unwrap(await api.days[':day'].log.$put({ param: { day }, json: draft })),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.day(day) }),
  });
}

/** 送信内容を確かめずに FB を依頼する（設定の「依頼の前に毎回確認する」が無効のとき） */
export function useRequestFeedback(day: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await api.jobs.$post({ json: { kind: 'daily_feedback', period: day } })),
    // 依頼したジョブを、すぐに生成中として表示する（進み具合は SSE で読み直す）
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.day(day) }),
  });
}
