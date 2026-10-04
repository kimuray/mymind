import type { MonthSummary, MonthSummaryJob } from '../api/calendar';
import { formatDateTime } from '../day';
import { Button } from './Button';
import { MarkdownPreview } from './MarkdownPreview';

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  fake: '偽のエージェント',
};

/** 総括の生成の状態（日次 FB の 4.6 と同じ4つ） */
export function summaryState(
  summary: MonthSummary | null,
  job: MonthSummaryJob | null,
): 'none' | 'generating' | 'failed' | 'done' {
  if (job?.status === 'queued' || job?.status === 'running') return 'generating';
  if (job?.status === 'failed') return 'failed';
  return summary?.content == null ? 'none' : 'done';
}

/** 「9月の総括」 */
export const summaryTitle = (ym: string) => `${Number(ym.slice(5))}月の総括`;

/**
 * 月次総括（FR-A06、FR-R05、DESIGN.md 4.14）。最新の総括を出し、依頼・生成中・失敗・再試行・キャンセルを扱う。
 * 各項目は Markdown を許し、サニタイズして表示する（4.7 のプレビュー）
 */
export function MonthlySummaryPanel({
  ym,
  summary,
  job,
  onRequest,
  onCancel,
  busy,
}: {
  ym: string;
  summary: MonthSummary | null;
  job: MonthSummaryJob | null;
  /** 依頼・再試行・もう一度もらう。省くと依頼のボタンを出さない（まだ来ていない月） */
  onRequest?: () => void;
  onCancel: (jobId: string) => void;
  busy: boolean;
}) {
  const state = summaryState(summary, job);
  const content = summary?.content ?? null;
  const sections =
    content === null
      ? []
      : [
          { key: 'learnings', title: '学び', items: content.learnings },
          { key: 'trends', title: '傾向', items: content.trends },
          { key: 'self_gap', title: '調子の判定と手での修正のズレ', items: [content.self_gap] },
          {
            key: 'proposals',
            title: summary?.isPartial === true ? '残りの日への提案' : '来月への提案',
            items: content.proposals,
          },
        ].filter((s) => s.items.length > 0);

  return (
    <section className="monthly-summary" aria-label={summaryTitle(ym)}>
      <div className="monthly-summary-head">
        <h2 className="text-title">{summaryTitle(ym)}</h2>
        {summary?.isPartial === true && state !== 'generating' && (
          <span className="chip" data-status="paused">
            途中経過
          </span>
        )}
      </div>

      <div aria-live="polite" className="feedback-body">
        {state === 'generating' && job !== null && (
          <div className="feedback-generating">
            <p>
              {job.status === 'queued'
                ? '前の依頼が終わるのを待っています'
                : 'マメがまとめています'}
            </p>
            <Button onClick={() => onCancel(job.id)} disabled={busy}>
              キャンセル
            </Button>
          </div>
        )}

        {state === 'failed' && job !== null && (
          <div className="feedback-failed">
            <p>{`総括をもらえませんでした：${job.error ?? '理由が分かりません'}`}</p>
            {onRequest !== undefined && (
              <Button kind="text" onClick={onRequest} disabled={busy}>
                再試行
              </Button>
            )}
          </div>
        )}

        {state === 'none' && (
          <div className="feedback-none">
            <p>まだ総括をもらっていません</p>
            {onRequest !== undefined && (
              <Button onClick={onRequest} disabled={busy}>
                総括をもらう
              </Button>
            )}
          </div>
        )}

        {content !== null && state !== 'generating' && (
          <>
            {sections.map((s) => (
              <section key={s.key} className="feedback-section" data-kind={s.key}>
                <h3>{s.title}</h3>
                {s.items.map((text) => (
                  <MarkdownPreview key={text} source={text} emptyText="" />
                ))}
              </section>
            ))}
            <div className="feedback-meta">
              <p className="text-small">
                {summary === null
                  ? ''
                  : `${formatDateTime(summary.createdAt)} に ${AGENT_NAMES[summary.agent] ?? summary.agent} で生成`}
              </p>
              {onRequest !== undefined && state === 'done' && (
                <Button kind="text" onClick={onRequest} disabled={busy}>
                  もう一度もらう
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
