import { type ReviewDecision, STATUS_LABELS } from '@mymind/domain';
import type { StaleTask } from '../api/review';
import { Button } from './Button';
import { Kbd } from './Kbd';

export type ReviewCounts = Readonly<Record<ReviewDecision, number>>;

export const NO_REVIEWS: ReviewCounts = { this_week: 0, keep: 0, drop: 0 };

/** 「8月12日」 */
const formatMonthDay = (day: string) => {
  const [, m, d] = day.split('-').map(Number);
  return `${m}月${d}日`;
};

/** カードの副題。一度も着手していないか、どの状態で止まっているか */
export function staleNote(task: Pick<StaleTask, 'hasStarted' | 'status'>): string {
  return task.hasStarted
    ? `${STATUS_LABELS[task.status]}のまま止まっています`
    : '一度も着手されていません';
}

/**
 * 棚卸し（FR-R06、DESIGN.md 4.15、Figma「PC/バックログ」の詳細ペイン）。対象を古い順に1件ずつ判断する。
 * 日数はサーバーが数えた値を出す
 */
export function StocktakePanel({
  tasks,
  afterDays,
  reviewed,
  onDecide,
  busy,
  error,
}: {
  tasks: readonly StaleTask[];
  afterDays: number;
  /** この画面を開いてから判断した件数（進み具合とまとめに使う） */
  reviewed: ReviewCounts;
  onDecide: (task: StaleTask, decision: ReviewDecision) => void;
  busy: boolean;
  error: string | null;
}) {
  const done = reviewed.this_week + reviewed.keep + reviewed.drop;
  const total = done + tasks.length;
  const current = tasks[0];

  return (
    <section className="stocktake" aria-label="棚卸し">
      <div className="stocktake-head">
        <h2 className="text-title">棚卸し</h2>
        <p className="text-small">{`${afterDays}日以上触れていないタスクを1件ずつ判断`}</p>
      </div>

      <div className="stocktake-progress">
        <p className="text-small">
          <span>進み具合</span>
          <span>{`${Math.min(done + 1, total)} / ${total}`}</span>
        </p>
        <progress value={done} max={total} aria-label="棚卸しの進み具合" />
      </div>

      {current === undefined ? (
        <div className="stocktake-card glass-2" role="status">
          <h3>棚卸し完了</h3>
          <p className="text-small">
            {`今週やる ${reviewed.this_week}件・残す ${reviewed.keep}件・中止 ${reviewed.drop}件`}
          </p>
        </div>
      ) : (
        <div className="stocktake-card glass-2">
          <div>
            <h3>{current.title}</h3>
            <p className="text-small">{staleNote(current)}</p>
          </div>
          <dl className="stocktake-facts">
            <div>
              <dt>追加した日</dt>
              <dd>{formatMonthDay(current.createdDay)}</dd>
            </div>
            <div>
              <dt>最後に触れてから</dt>
              <dd>{`${current.daysSinceTouched}日`}</dd>
            </div>
          </dl>
          <Button kind="primary" disabled={busy} onClick={() => onDecide(current, 'this_week')}>
            今週やる
            <Kbd tone="dark">1</Kbd>
          </Button>
          <div className="stocktake-actions">
            <Button disabled={busy} onClick={() => onDecide(current, 'keep')}>
              残す
              <Kbd>2</Kbd>
            </Button>
            <Button
              className="stocktake-drop"
              disabled={busy}
              onClick={() => onDecide(current, 'drop')}
            >
              中止にする
              <Kbd>3</Kbd>
            </Button>
          </div>
        </div>
      )}
      {error !== null && (
        <p className="settings-note" role="alert">
          {error}
        </p>
      )}
      <p className="text-small">
        中止にしたタスクは削除されず、「やめると決めた」記録として残ります。
      </p>
    </section>
  );
}
