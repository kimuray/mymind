import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { AgentChoice } from './settings';

/** 依頼の種類。日次 FB は業務日、月次総括は月を period に渡す（FR-A06） */
export type InputKind = 'daily_feedback' | 'monthly_summary';

/** 送信内容のプレビュー（FR-A12、POST /api/agent-input/preview） */
const fetchPreview = async (kind: InputKind, period: string) =>
  unwrap(await api['agent-input'].preview.$post({ json: { kind, period } }));

type AnyPreview = Awaited<ReturnType<typeof fetchPreview>>;

/** 日次 FB の送信内容。応答は種類（kind）で中身の形が分かれる */
export type AgentInputPreview = Extract<AnyPreview, { kind: 'daily_feedback' }>;
/** 月次総括の送信内容（FR-A06） */
export type MonthlyInputPreview = Extract<AnyPreview, { kind: 'monthly_summary' }>;
export type DailyPayload = AgentInputPreview['payload'];
export type InputAnnotation = AgentInputPreview['annotations'][number];

const previewKey = (kind: InputKind, period: string) =>
  ['agent-input-preview', kind, period] as const;

export function useAgentInputPreview(kind: InputKind, period: string) {
  return useQuery({
    queryKey: previewKey(kind, period),
    queryFn: () => fetchPreview(kind, period),
    // 確認した時点の内容を見せるため、開くたびに作り直し、裏で勝手に読み直さない（読み直すと確認中の表示が変わる）
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * 確認した内容で FB や総括を依頼する。確認した後に内容が変わっていれば、サーバーが 409（PREVIEW_STALE）を返す。
 * そのときはプレビューを作り直し、利用者にもう一度確かめてもらう
 */
export function useRequestPreviewedFeedback(kind: InputKind, period: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ payloadHash, agent }: { payloadHash: string; agent?: AgentChoice }) =>
      unwrap(
        await api.jobs.$post({
          json: { kind, period, payloadHash, ...(agent && { agent }) },
        }),
      ),
    onError: () => qc.invalidateQueries({ queryKey: previewKey(kind, period) }),
    // 依頼したジョブを、その日の FB の欄やその月の総括の欄に、すぐ生成中として出す
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: [kind === 'daily_feedback' ? 'day' : 'month', period] }),
  });
}
