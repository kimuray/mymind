import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';

/** 送信内容のプレビュー（FR-A12、POST /api/agent-input/preview） */
const fetchPreview = async (period: string) =>
  unwrap(await api['agent-input'].preview.$post({ json: { kind: 'daily_feedback', period } }));

export type AgentInputPreview = Awaited<ReturnType<typeof fetchPreview>>;
export type DailyPayload = AgentInputPreview['payload'];
export type InputAnnotation = AgentInputPreview['annotations'][number];

const previewKey = (period: string) => ['agent-input-preview', period] as const;

export function useAgentInputPreview(period: string) {
  return useQuery({
    queryKey: previewKey(period),
    queryFn: () => fetchPreview(period),
    // 確認した時点の内容を見せるため、開くたびに作り直し、裏で勝手に読み直さない（読み直すと確認中の表示が変わる）
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * 確認した内容で FB を依頼する。確認した後に内容が変わっていれば、サーバーが 409（PREVIEW_STALE）を返す。
 * そのときはプレビューを作り直し、利用者にもう一度確かめてもらう
 */
export function useRequestPreviewedFeedback(period: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payloadHash: string) =>
      unwrap(await api.jobs.$post({ json: { kind: 'daily_feedback', period, payloadHash } })),
    onError: () => qc.invalidateQueries({ queryKey: previewKey(period) }),
  });
}
