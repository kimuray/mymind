import { STATUS_LABELS } from '@mymind/domain';
import type { RegenerateResponse } from '../api/calendar';
import { Button } from './Button';

type Diff = NonNullable<RegenerateResponse['diff']>;

const COUNT_LABELS: Record<Diff['counts'][number]['key'], string> = {
  planned: '計画',
  done: '完了',
  doing: '着手中',
  paused: '中断',
  waiting: '待ち',
};

/** タスク1件の違い */
function describeTaskChange(t: Diff['tasks'][number]): string {
  switch (t.kind) {
    case 'status_changed':
      return `${t.title}：${STATUS_LABELS[t.from]} → ${STATUS_LABELS[t.to]}`;
    case 'added':
      return `${t.title}：計画に加わった（${STATUS_LABELS[t.status]}）`;
    case 'removed':
      return `${t.title}：計画からなくなった`;
  }
}

/** 再生成の前後の違いを、1行ずつの文にする（FR-R07）。件数はサーバーが数えた値をそのまま出す */
export function formatRecordDiff(diff: Diff): string[] {
  const tasks = diff.tasks.map(describeTaskChange);
  const counts = diff.counts.map((c) => `${COUNT_LABELS[c.key]} ${c.before} → ${c.after}`);
  // 状態の違いに出ない完了の出入り（計画にないタスクの完了など）だけを足す
  const listed = new Set(diff.tasks.map((t) => t.title));
  const completed = [
    ...diff.completed.added.filter((t) => !listed.has(t)).map((t) => `${t}：完了に加わった`),
    ...diff.completed.removed.filter((t) => !listed.has(t)).map((t) => `${t}：完了から外れた`),
  ];
  return [...tasks, ...completed, ...counts];
}

/**
 * 「記録を再生成」（FR-R07、DESIGN.md 4.14）。記録の不整合に気づいたときに、その日の記録をイベントから作り直す。
 * 結果（違い、または変わりがなかったこと）を出し、変わっていて FB がある日は、FB をもう一度もらうかを選べる
 */
export function RecordRegenerate({
  result,
  busy,
  failed,
  onRegenerate,
  onRequestFeedback,
}: {
  /** 直前の再生成の結果。まだ押していなければ undefined */
  result: RegenerateResponse | undefined;
  busy: boolean;
  failed: boolean;
  onRegenerate: () => void;
  onRequestFeedback: () => void;
}) {
  const lines = result?.diff ? formatRecordDiff(result.diff) : [];
  return (
    <section className="record-regenerate" aria-label="記録の再生成">
      <Button kind="text" busy={busy} onClick={onRegenerate}>
        記録を再生成
      </Button>
      <div className="record-regenerate-result" aria-live="polite">
        {failed && <p className="text-small">記録を再生成できませんでした</p>}
        {result !== undefined && !failed && (
          <>
            {!result.hadSnapshot && <p className="text-small">この日の記録を作りました</p>}
            {result.hadSnapshot && !result.changed && (
              <p className="text-small">変わりはありませんでした</p>
            )}
            {result.changed && (
              <>
                <p className="text-small">記録を作り直しました。変わったところ：</p>
                <ul className="record-regenerate-diff">
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {result.hasFeedback && (
                  <p className="text-small">
                    この日の FB は、作り直す前の記録から作られています。
                    <Button kind="text" onClick={onRequestFeedback}>
                      FBをもう一度もらう
                    </Button>
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
