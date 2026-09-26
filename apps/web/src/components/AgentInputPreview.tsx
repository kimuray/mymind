import { STATUS_LABELS } from '@mymind/domain';
import type { ReactNode } from 'react';
import {
  type InputAnnotation,
  type AgentInputPreview as Preview,
  useAgentInputPreview,
  useRequestPreviewedFeedback,
} from '../api/agentInput';
import { ApiError } from '../api/client';
import { formatShortDay } from '../day';
import { Button } from './Button';

/** 注記の種類の表示名。種類が増えても、名前がなければ種類をそのまま出す（architecture.md 12.5） */
const ANNOTATION_KINDS: Record<string, string> = { truncated: '切り詰め', omitted: '省略' };

/** 送る JSON の最上位の項目と、画面の見出し。この順に並べる */
const SECTIONS = [
  { key: 'reflection', title: '振り返り' },
  { key: 'tasks', title: 'タスク' },
  { key: 'stats', title: '集計値' },
  { key: 'recent', title: '直近の情報' },
] as const;

const STAT_LABELS: Record<string, string> = {
  planned: '計画',
  done: '完了',
  doing: '着手中',
  paused: '中断',
  waiting: '待ち',
};

/** 注記を、どの項目のものかで分ける。知らない項目の注記は「その他」に集める */
export function groupAnnotations(annotations: readonly InputAnnotation[]) {
  const known = new Set<string>(SECTIONS.map((s) => s.key));
  const bySection = new Map<string, InputAnnotation[]>();
  for (const a of annotations) {
    const head = a.path.split('.')[0] ?? '';
    const key = known.has(head) ? head : 'other';
    bySection.set(key, [...(bySection.get(key) ?? []), a]);
  }
  return bySection;
}

/** 画面で1つの要素として描く箇所の path。注記の path がこれに一致すれば、その要素を強調する */
export function renderedPaths(payload: Preview['payload']): Set<string> {
  return new Set([
    ...(payload.reflection === undefined
      ? []
      : ['reflection.thoughts_md', 'reflection.learning_md']),
    ...payload.tasks.map((_, i) => `tasks.${i}`),
  ]);
}

/** 省いた項目は payload に残っていない（同じ path に別の項目がある）ので、要素には付けない */
const isAttached = (a: InputAnnotation, rendered: Set<string>) =>
  a.kind !== 'omitted' && rendered.has(a.path);

function AnnotationNote({ annotation }: { annotation: InputAnnotation }) {
  return (
    <p className="input-annotation">
      <span className="input-annotation-kind">
        {ANNOTATION_KINDS[annotation.kind] ?? annotation.kind}
      </span>
      {annotation.reason}
      <span className="input-annotation-path">（{annotation.path}）</span>
    </p>
  );
}

/** 1つの値。注記があればその箇所を強調し、理由を添える */
function Field({
  label,
  path,
  annotations,
  children,
}: {
  label: string;
  path: string;
  annotations: readonly InputAnnotation[];
  children: ReactNode;
}) {
  const mine = annotations.filter((a) => a.path === path);
  return (
    <div className="input-field" data-annotated={mine.length > 0}>
      <h4>{label}</h4>
      {children}
      {mine.map((a) => (
        <AnnotationNote key={`${a.kind}:${a.path}`} annotation={a} />
      ))}
    </div>
  );
}

function SectionBody({
  sectionKey,
  payload,
  annotations,
}: {
  sectionKey: (typeof SECTIONS)[number]['key'];
  payload: Preview['payload'];
  annotations: readonly InputAnnotation[];
}) {
  switch (sectionKey) {
    case 'reflection':
      return payload.reflection === undefined ? (
        <p className="input-empty">振り返りは送りません（まだ書いていません）</p>
      ) : (
        <>
          <Field label="思考の整理" path="reflection.thoughts_md" annotations={annotations}>
            <pre className="input-text">{payload.reflection.thoughts_md}</pre>
          </Field>
          <Field label="学び" path="reflection.learning_md" annotations={annotations}>
            <pre className="input-text">{payload.reflection.learning_md}</pre>
          </Field>
        </>
      );
    case 'tasks':
      return payload.tasks.length === 0 ? (
        <p className="input-empty">計画にタスクはありません</p>
      ) : (
        <ul className="input-list">
          {payload.tasks.map((t, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: 送る順番が項目の位置（注記の path も tasks.<順番>）で、並べ替えない
              key={i}
              data-annotated={annotations.some((a) => a.path === `tasks.${i}`)}
            >
              <span className="input-list-main">{t.title}</span>
              <span className="input-list-note">
                {STATUS_LABELS[t.status]}・{t.days}日目
                {t.parent === undefined ? '' : `・親：${t.parent}`}
              </span>
              {annotations
                .filter((a) => a.path === `tasks.${i}`)
                .map((a) => (
                  <AnnotationNote key={`${a.kind}:${a.path}`} annotation={a} />
                ))}
            </li>
          ))}
        </ul>
      );
    case 'stats':
      return (
        <dl className="input-stats">
          {Object.entries(payload.stats).map(([key, value]) => (
            <div key={key}>
              <dt>{STAT_LABELS[key] ?? key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'recent':
      return payload.recent.length === 0 ? (
        <p className="input-empty">直近の情報は送りません</p>
      ) : (
        <ul className="input-list">
          {payload.recent.map((r) => (
            <li key={r.day}>
              <span className="input-list-main">{formatShortDay(r.day)}</span>
              <span className="input-list-note">
                {r.blank
                  ? '記録なし'
                  : `調子 ${r.condition ?? '—'}・明日の一手：${r.next_action ?? '—'}`}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

/** 送信内容の表示（DESIGN.md 4.11）。データを受け取って描くだけの部分 */
export function AgentInputPreviewView({
  preview,
  footer,
}: {
  preview: Preview;
  footer?: ReactNode;
}) {
  const grouped = groupAnnotations(preview.annotations);
  const other = grouped.get('other') ?? [];
  const rendered = renderedPaths(preview.payload);
  return (
    <div className="input-preview">
      <div className="settings-detail-head">
        <h2 className="text-title">送信内容</h2>
        <p className="text-small">
          エージェントに送る内容です（{preview.charCount.toLocaleString('ja-JP')}文字）
          {preview.annotations.length > 0 &&
            `。加工した箇所が${preview.annotations.length}件あります`}
        </p>
      </div>
      {other.length > 0 && (
        <section className="input-section glass-2" aria-label="その他の加工">
          {other.map((a) => (
            <AnnotationNote key={`${a.kind}:${a.path}`} annotation={a} />
          ))}
        </section>
      )}
      {SECTIONS.map((s) => {
        const annotations = grouped.get(s.key) ?? [];
        const attached = annotations.filter((a) => isAttached(a, rendered));
        // 省いた項目や、画面の要素にない箇所の注記は、見出しの下に理由を出す
        const detached = annotations.filter((a) => !isAttached(a, rendered));
        return (
          <section
            key={s.key}
            className="input-section glass-2"
            aria-label={s.title}
            data-annotated={annotations.length > 0}
          >
            <h3>{s.title}</h3>
            {detached.map((a) => (
              <AnnotationNote key={`${a.kind}:${a.path}`} annotation={a} />
            ))}
            <SectionBody sectionKey={s.key} payload={preview.payload} annotations={attached} />
          </section>
        );
      })}
      <details className="input-raw">
        <summary>送る JSON をそのまま見る</summary>
        <pre className="input-text">{JSON.stringify(preview.payload, null, 2)}</pre>
      </details>
      {footer}
    </div>
  );
}

/**
 * 送信内容のプレビュー（FR-A12）。詳細ペインに置き、「この内容でFBをもらう」で確認した内容のまま依頼する。
 * 確認した後に内容が変わっていたら（409 PREVIEW_STALE）、新しい内容を出してもう一度確かめてもらう
 */
export function AgentInputPreview({
  period,
  onRequested,
}: {
  period: string;
  onRequested?: (jobId: string) => void;
}) {
  const preview = useAgentInputPreview(period);
  const request = useRequestPreviewedFeedback(period);
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
  const footer = (
    <div className="input-preview-actions">
      <p className="text-small" aria-live="polite">
        {isStale
          ? '確認した後に送信内容が変わりました。新しい内容を確かめてから、もう一度依頼してください'
          : request.isError
            ? `依頼できませんでした（${request.error.message}）`
            : request.isSuccess
              ? '依頼しました'
              : ''}
      </p>
      <Button
        kind="confirm"
        disabled={request.isPending || preview.isFetching || request.isSuccess}
        onClick={() =>
          request.mutate(data.payloadHash, {
            onSuccess: ({ job }) => onRequested?.(job.id),
          })
        }
      >
        この内容でFBをもらう
      </Button>
    </div>
  );
  return <AgentInputPreviewView preview={data} footer={footer} />;
}
