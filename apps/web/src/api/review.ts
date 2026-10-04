import type { ReviewDecision } from '@mymind/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { invalidateTasks, type ListTask } from './tasks';

/** 棚卸しの対象（GET /api/review/stale、FR-R06） */
const fetchStale = async () => unwrap(await api.review.stale.$get());

export type StaleResponse = Awaited<ReturnType<typeof fetchStale>>;
export type StaleTask = StaleResponse['tasks'][number];

export function useStaleTasks() {
  return useQuery({ queryKey: ['review', 'stale'], queryFn: fetchStale });
}

/** 棚卸しの判断を送る（POST /api/review/decisions） */
export function useReviewDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      task: Pick<ListTask, 'id' | 'version'>;
      decision: ReviewDecision;
      expectedDay: string;
      allowPastDay?: boolean;
    }) =>
      unwrap(
        await api.review.decisions.$post({
          json: {
            taskId: input.task.id,
            expectedVersion: input.task.version,
            decision: input.decision,
            expectedDay: input.expectedDay,
            ...(input.allowPastDay === undefined ? {} : { allowPastDay: input.allowPastDay }),
          },
        }),
      ),
    // 今日の計画・バックログ・棚卸しの対象を読み直し、他のタブにも知らせる
    onSettled: () => invalidateTasks(qc),
  });
}
