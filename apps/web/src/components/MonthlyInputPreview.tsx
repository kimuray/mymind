import type { ReactNode } from 'react';
import {
  type MonthlyInputPreview as Preview,
  useAgentInputPreview,
  useRequestPreviewedFeedback,
} from '../api/agentInput';
import { ApiError } from '../api/client';
import type { AgentChoice } from '../api/settings';
import { formatShortDay } from '../day';
import { AnnotationNote } from './AgentInputPreview';
import { Button } from './Button';

/** 月次総括に送る集計値の表示名（サーバーが数えた値をそのまま出す、FR-A10） */
const STAT_LABELS: Record<string, string> = {
  recorded_days: '記録のある日',
  blank_days: '空白日',
  feedback_days: 'FBをもらった日',
  corrected_days: '調子を手で直した日',
  completed: '完了したタスク',
};

const conditionText = (ai: number | null, user: number | null) => {
  if (ai === null && user === null) return '調子なし';
  if (user !== null && ai !== null && user !== ai) return `調子 ${ai} → 手で ${user}`;
  return `調子 ${user ?? ai}`;
};

/** 月次総括の送信内容（FR-A06、FR-A12、DESIGN.md 4.11）。データを受け取って描くだけの部分 */
export function MonthlyInputPreviewView({
  preview,
  footer,
}: {
  preview: Preview;
  footer?: ReactNode;
}) {
  const { payload, annotations } = preview;
  return (
    <div className="input-preview">
      <div className="settings-detail-head">
        <h2 className="text-title">送信内容</h2>
        <p className="text-small">
          エージェントに送る内容です（{preview.charCount.toLocaleString('ja-JP')}文字）
          {annotations.length > 0 && `。加工した箇所が${annotations.length}件あります`}
          {payload.partial && `。${formatShortDay(payload.through)}までの途中経過として送ります`}
        </p>
      </div>
      <section className="input-section neu-raised-1" aria-label="集計値">
        <h3>集計値</h3>
        <dl className="input-stats">
          {Object.entries(payload.stats).flatMap(([key, value]) =>
            typeof value === 'number'
              ? [
                  <div key={key}>
                    <dt>{STAT_LABELS[key] ?? key}</dt>
                    <dd>{value}</dd>
                  </div>,
                ]
              : [],
          )}
        </dl>
      </section>
      {payload.stats.by_tag.length > 0 && (
        <section className="input-section neu-raised-1" aria-label="タグごとの集計">
          <h3>タグごとの集計</h3>
          <p className="text-small">
            タグの名前と、アプリが数えた値だけを送ります（メモは送りません）
          </p>
          <ul className="input-days">
            {payload.stats.by_tag.map((t) => (
              <li key={t.tag ?? 'none'}>
                <span className="input-day">{t.tag ?? 'タグなし'}</span>
                <span>{`完了 ${t.completed}件／着手中 ${t.doing_days}日／待ち ${t.waiting_days}日`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        className="input-section neu-raised-1"
        aria-label="日ごとの記録"
        data-annotated={annotations.length > 0}
      >
        <h3>日ごとの記録</h3>
        <p className="text-small">
          振り返りの全文は送らず、FB の要点と、FB のない日は振り返りの冒頭だけを送ります
        </p>
        {annotations.map((a) => (
          <AnnotationNote key={`${a.kind}:${a.path}`} annotation={a} />
        ))}
        <ul className="input-days">
          {payload.days.map((d) => (
            <li key={d.day}>
              <span className="input-day">{formatShortDay(d.day)}</span>
              {d.blank ? (
                <span className="text-small">記録なし</span>
              ) : (
                <span>
                  {[
                    conditionText(d.condition_ai, d.condition_user),
                    ...(d.good ?? []).map((t) => `よかったこと：${t}`),
                    ...(d.insight ?? []).map((t) => `気づき：${t}`),
                    ...(d.next_action === undefined ? [] : [`明日の一手：${d.next_action}`]),
                    ...(d.reflection_head === undefined
                      ? []
                      : [`振り返りの冒頭：${d.reflection_head}`]),
                  ].join('／')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <details className="input-raw">
        <summary>送る JSON をそのまま見る</summary>
        <pre className="input-text">{JSON.stringify(payload, null, 2)}</pre>
      </details>
      {footer}
    </div>
  );
}

/**
 * 月次総括の送信内容のプレビュー。「この内容で総括をもらう」で、確認した内容のまま依頼する。
 * 確認した後に内容が変わっていたら（409 PREVIEW_STALE）、新しい内容を出してもう一度確かめてもらう
 */
export function MonthlyInputPreview({
  ym,
  agent,
  onRequested,
}: {
  ym: string;
  agent?: AgentChoice | undefined;
  onRequested?: () => void;
}) {
  const preview = useAgentInputPreview('monthly_summary', ym);
  const request = useRequestPreviewedFeedback('monthly_summary', ym);
  const isStale = request.error instanceof ApiError && request.error.code === 'PREVIEW_STALE';

  if (preview.isPending) return <p className="text-small">送信内容を組み立てています…</p>;
  if (preview.isError) {
    return (
      <p className="settings-note" role="alert">
        送信内容を読み込めませんでした。サーバーが動いているか確かめてください
      </p>
    );
  }
  const data = preview.data;
  // 月次総括を頼んでいるので、ほかの種類は返ってこない
  if (data.kind !== 'monthly_summary') return null;
  const footer = (
    <div className="input-preview-actions">
      <p className="text-small" aria-live="polite">
        {isStale
          ? '確認した後に送信内容が変わりました。新しい内容を確かめてから、もう一度依頼してください'
          : request.isError
            ? `依頼できませんでした（${request.error.message}）`
            : ''}
      </p>
      <Button
        kind="confirm"
        disabled={request.isPending || preview.isFetching || request.isSuccess}
        onClick={() =>
          request.mutate(
            { payloadHash: data.payloadHash, ...(agent && { agent }) },
            { onSuccess: () => onRequested?.() },
          )
        }
      >
        この内容で総括をもらう
      </Button>
    </div>
  );
  return <MonthlyInputPreviewView preview={data} footer={footer} />;
}
