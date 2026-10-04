import type { ReviewDecision } from '@mymind/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { type BacklogResponse, invalidateTasks, type ListTask, queryKeys } from './tasks';

/** 棚卸しの対象（GET /api/review/stale、FR-R06） */
const fetchStale = async () => unwrap(await api.review.stale.$get());

export type StaleResponse = Awaited<ReturnType<typeof fetchStale>>;
export type StaleTask = StaleResponse['tasks'][number];

const staleKey = ['review', 'stale'] as const;

export function useStaleTasks() {
  return useQuery({ queryKey: staleKey, queryFn: fetchStale });
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
    // 判断したタスクは、返事を待たずに棚卸しの対象から外す（ui.md の楽観的更新、NFR-03）。
    // 今週やると中止はバックログからも外す。失敗したら元に戻す
    onMutate: async ({ task, decision }) => {
      await qc.cancelQueries({ queryKey: staleKey });
      await qc.cancelQueries({ queryKey: queryKeys.backlog });
      const stale = qc.getQueryData<StaleResponse>(staleKey);
      const backlog = qc.getQueryData<BacklogResponse>(queryKeys.backlog);
      if (stale !== undefined) {
        qc.setQueryData<StaleResponse>(staleKey, {
          ...stale,
          tasks: stale.tasks.filter((t) => t.id !== task.id),
        });
      }
      if (backlog !== undefined && decision !== 'keep') {
        qc.setQueryData<BacklogResponse>(queryKeys.backlog, {
          ...backlog,
          tasks: backlog.tasks.filter((t) => t.id !== task.id),
        });
      }
      return { stale, backlog };
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot?.stale !== undefined) qc.setQueryData(staleKey, snapshot.stale);
      if (snapshot?.backlog !== undefined) qc.setQueryData(queryKeys.backlog, snapshot.backlog);
    },
    // 今日の計画・バックログ・棚卸しの対象を読み直し、他のタブにも知らせる
    onSettled: () => invalidateTasks(qc),
  });
}
