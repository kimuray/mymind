import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';

/** タイムライン（GET /api/timeline、FR-R01〜R03）。区間と内訳はサーバーが domain で計算した値 */
const fetchTimeline = async (from: string, to: string) =>
  unwrap(await api.timeline.$get({ query: { from, to } }));

export type TimelineResponse = Awaited<ReturnType<typeof fetchTimeline>>;
export type TimelineTask = TimelineResponse['tasks'][number];

export function useTimeline(from: string, to: string) {
  return useQuery({
    queryKey: ['timeline', from, to],
    queryFn: () => fetchTimeline(from, to),
    // 期間を切り替えている間は、前の期間の表を出したままにする（表が消えてちらつかないように）
    placeholderData: (previous) => previous,
  });
}
