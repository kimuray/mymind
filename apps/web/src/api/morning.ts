import type { CarryoverDecision } from '@mymind/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { invalidateTasks } from './tasks';

const fetchCarryover = async (day: string) =>
  unwrap(await api.days[':day'].carryover.$get({ param: { day } }));

export type Carryover = Awaited<ReturnType<typeof fetchCarryover>>;

/**
 * 持ち越し候補（FR-D03、GET /api/days/:day/carryover）。
 * ['day'] の下には置かない（楽観的更新が ['day'] のキャッシュを計画の一覧の形とみなして書き換えるため）
 */
export const carryoverKey = (day: string) => ['carryover', day] as const;

export function useCarryover(day: string) {
  return useQuery({ queryKey: carryoverKey(day), queryFn: () => fetchCarryover(day) });
}

/** 朝の計画をまとめて確定する（FR-D05、POST /api/days/:day/plan）。確定するまでは何も送らない */
export function useConfirmPlan(day: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      decisions: { taskId: string; decision: CarryoverDecision }[];
      additions: string[];
    }) =>
      unwrap(
        await api.days[':day'].plan.$post({ param: { day }, json: { expectedDay: day, ...input } }),
      ),
    onSettled: () => invalidateTasks(qc),
  });
}
