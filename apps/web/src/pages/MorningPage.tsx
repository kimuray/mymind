import {
  type CarryoverDecision,
  dayOrdinalSince,
  daysBetween,
  STATUS_LABELS,
} from '@mymind/domain';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useSetCondition } from '../api/feedback';
import { useCarryover, useConfirmPlan } from '../api/morning';
import { type ListTask, useBacklog, useDayPlan } from '../api/tasks';
import { Button } from '../components/Button';
import { FeedbackPanel } from '../components/FeedbackPanel';
import { Kbd } from '../components/Kbd';
import { PageLayout } from '../components/PageLayout';
import { dayOf, formatDayHeading, formatDaysAgo } from '../day';
import { useDayGuard } from '../dayGuard';
import { useKeyBindings } from '../keyboard';
import { useListMotion } from '../listMotion';
import { useSelectionMotion } from '../selectionMotion';

const DECISIONS: readonly { value: CarryoverDecision; label: string }[] = [
  { value: 'today', label: '今日もやる' },
  { value: 'backlog', label: 'バックログへ' },
  { value: 'done', label: '実は終わった' },
];

type Row = { kind: 'carryover' | 'backlog'; task: ListTask };

/** 持ち越しの見出し。前日なら「昨日の持ち越し」、空白日をはさめば基準日と「N日ぶりの計画です」（FR-D09） */
export function carryoverHeading(baseDay: string | null, today: string) {
  if (baseDay === null) return { title: '持ち越し', note: null };
  const days = daysBetween(baseDay, today);
  if (days <= 1) return { title: '昨日の持ち越し', note: null };
  return {
    title: `${formatDayHeading(baseDay).date}の持ち越し`,
    note: `${days}日ぶりの計画です`,
  };
}

/** 前日の FB の見出しと日付（「昨日のフィードバック」と「9月21日（月）」） */
export function previousFeedbackLabels(previousDay: string, today: string) {
  const { date, weekday } = formatDayHeading(previousDay);
  return {
    heading:
      daysBetween(previousDay, today) <= 1 ? '昨日のフィードバック' : `${date}のフィードバック`,
    dayLabel: `${date}（${weekday.slice(0, 1)}）`,
  };
}

/** 状態と日数のチップの文言（「待ち・5日目」「未着手」） */
const chipText = (task: ListTask, today: string) =>
  task.status === 'todo'
    ? STATUS_LABELS[task.status]
    : `${STATUS_LABELS[task.status]}・${dayOrdinalSince(task.statusSince, today)}日目`;

/**
 * 朝の計画の画面（Figma「PC/朝の計画」、FR-D03・FR-D04・FR-D05・FR-D09）。
 * 判断と追加は画面の中だけに持ち、「計画を確定」で1回だけ送る。確定する前に画面を離れても何も反映しない
 */
export function MorningPage() {
  const guard = useDayGuard();
  const day = guard.day;
  const carryover = useCarryover(day);
  const backlog = useBacklog();
  // 行の出入りを目で追えるようにする（DESIGN.md 4.18）
  const listRoot = useRef<HTMLDivElement>(null);
  useListMotion(listRoot, carryover.isSuccess && backlog.isSuccess);
  // 選択の面を行から行へ滑らせる（DESIGN.md 5.2）
  useSelectionMotion(listRoot);
  const plan = useDayPlan(day);
  const confirm = useConfirmPlan(day);
  const [decisions, setDecisions] = useState<ReadonlyMap<string, CarryoverDecision>>(new Map());
  const [additions, setAdditions] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const heading = formatDayHeading(day);
  const previous = plan.data?.previous ?? null;
  // 前日の FB の調子をその場で直す（FR-A03）。前日の FB がなければ使わない
  const setCondition = useSetCondition(previous?.day ?? day);

  const candidates = carryover.data?.candidates ?? [];
  const candidateIds = new Set(candidates.map((t) => t.id));
  // 持ち越し候補もバックログにあたるので、バックログの欄からは除く
  const backlogTasks = (backlog.data?.tasks ?? []).filter((t) => !candidateIds.has(t.id));
  const rows: Row[] = [
    ...candidates.map((task) => ({ kind: 'carryover' as const, task })),
    ...backlogTasks.map((task) => ({ kind: 'backlog' as const, task })),
  ];
  const selected = rows.find((r) => r.task.id === selectedId);
  const decidedCount = candidates.filter((t) => decisions.has(t.id)).length;
  const allDecided = decidedCount === candidates.length;
  const plannedCount =
    (plan.data?.tasks.length ?? 0) +
    [...decisions.values()].filter((d) => d === 'today').length +
    additions.size;
  const confirmedAt = confirm.data?.confirmedAt ?? carryover.data?.confirmedAt ?? null;

  const decide = (taskId: string, decision: CarryoverDecision) =>
    setDecisions((m) => new Map(m).set(taskId, decision));
  const toggleAddition = (taskId: string) =>
    setAdditions((s) => {
      const next = new Set(s);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    });
  const submit = () => {
    if (!allDecided || confirm.isPending || confirmedAt !== null) return;
    confirm.mutate({
      decisions: candidates.flatMap((t) => {
        const decision = decisions.get(t.id);
        return decision === undefined ? [] : [{ taskId: t.id, decision }];
      }),
      additions: backlogTasks.filter((t) => additions.has(t.id)).map((t) => t.id),
    });
  };
  const moveSelection = (step: 1 | -1) => {
    if (rows.length === 0) return false;
    const i = rows.findIndex((r) => r.task.id === selectedId);
    const next =
      i < 0 ? (step === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + step));
    setSelectedId(rows[next]?.task.id ?? null);
    return true;
  };
  const decideSelected = (decision: CarryoverDecision) => {
    if (selected?.kind !== 'carryover') return false;
    decide(selected.task.id, decision);
    return true;
  };

  useKeyBindings({
    'list.next': () => moveSelection(1),
    'list.prev': () => moveSelection(-1),
    'decide.first': () => decideSelected('today'),
    'decide.second': () => decideSelected('backlog'),
    'decide.third': () => decideSelected('done'),
    'list.dayKey': () => {
      if (selected?.kind !== 'backlog') return false;
      toggleAddition(selected.task.id);
      return true;
    },
    'screen.submit': () => {
      submit();
      return true;
    },
  });

  const header = (
    <header className="page-header">
      <div className="reflection-title">
        <p className="text-label">朝の計画</p>
        <h1 className="text-display">
          {heading.date}
          <span className="page-weekday">{heading.weekday}</span>
        </h1>
      </div>
    </header>
  );

  // 詳細ペイン：前日の FB と調子（FR-D02）。「前日」は最後に FB をもらった日（architecture.md 4.5）
  const previousLabels = previous === null ? null : previousFeedbackLabels(previous.day, day);
  const detail =
    previous === null || previousLabels === null ? undefined : (
      <FeedbackPanel
        heading={previousLabels.heading}
        dayLabel={previousLabels.dayLabel}
        feedback={previous.feedback}
        condition={previous.condition}
        job={null}
        nextActionTitle="今日の一手"
        onChangeCondition={(level) => setCondition.mutate(level)}
      />
    );
  const emptyNote = 'FBをもらうと、次の朝ここに表示されます';

  if (confirmedAt !== null) {
    return (
      <PageLayout detail={detail} emptyNote={emptyNote}>
        {guard.dialog}
        <div className="page morning">
          {header}
          <section className="morning-done glass-2" aria-live="polite">
            <p>{`今日の計画を確定しました（${plan.data?.tasks.length ?? plannedCount}件）`}</p>
            <Link to="/" className="button button-primary">
              今日の画面へ
            </Link>
          </section>
        </div>
      </PageLayout>
    );
  }

  const carryoverTitle = carryoverHeading(carryover.data?.baseDay ?? null, day);
  return (
    <PageLayout detail={detail} emptyNote={emptyNote}>
      {guard.dialog}
      <div className="page morning" ref={listRoot}>
        {header}

        <div className="morning-section-head">
          <h2>{carryoverTitle.title}</h2>
          {carryoverTitle.note !== null && <p className="text-small">{carryoverTitle.note}</p>}
          {candidates.length > 0 && (
            <p className="text-small morning-progress">
              {`${decidedCount} / ${candidates.length} 件を判断済み`}
            </p>
          )}
        </div>
        {carryover.isSuccess && candidates.length === 0 ? (
          <p className="empty-note">持ち越すタスクはありません</p>
        ) : (
          <ul className="task-list glass-2" aria-label="持ち越し">
            {candidates.map((task) => (
              <li
                key={task.id}
                data-motion-key={task.id}
                className="morning-row"
                data-selected={task.id === selectedId}
                aria-current={task.id === selectedId ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="morning-row-main"
                  onClick={() => setSelectedId(task.id)}
                >
                  <span className="morning-row-title">
                    <span className="morning-row-name">{task.title}</span>
                    {task.parentTitle !== null && (
                      <span className="morning-row-note">{task.parentTitle}</span>
                    )}
                  </span>
                  <span className="morning-row-meta">
                    <span className="chip" data-status={task.status}>
                      {chipText(task, day)}
                    </span>
                    <span className="morning-row-note">
                      {`最後の更新 ${formatDaysAgo(dayOf(task.lastTouchedAt), day)}`}
                    </span>
                  </span>
                </button>
                <fieldset
                  className="segmented morning-decisions"
                  aria-label={`${task.title}の判断`}
                >
                  {DECISIONS.map((d, i) => (
                    <button
                      key={d.value}
                      type="button"
                      className="segmented-item"
                      aria-pressed={decisions.get(task.id) === d.value}
                      aria-keyshortcuts={String(i + 1)}
                      onClick={() => {
                        setSelectedId(task.id);
                        decide(task.id, d.value);
                      }}
                    >
                      {d.label}
                    </button>
                  ))}
                </fieldset>
              </li>
            ))}
          </ul>
        )}

        <div className="morning-section-head">
          <h2>バックログから今日へ</h2>
          <p className="text-small morning-progress">選択して T でも追加</p>
        </div>
        {backlog.isSuccess && backlogTasks.length === 0 ? (
          <p className="empty-note">バックログにタスクはありません</p>
        ) : (
          <ul className="task-list glass-2" aria-label="バックログから今日へ">
            {backlogTasks.map((task) => {
              const added = additions.has(task.id);
              return (
                <li
                  key={task.id}
                  data-motion-key={task.id}
                  className="morning-row"
                  data-selected={task.id === selectedId}
                  data-added={added}
                  aria-current={task.id === selectedId ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className="morning-row-main"
                    onClick={() => setSelectedId(task.id)}
                  >
                    <span className="morning-row-title">
                      <span className="morning-row-name">{task.title}</span>
                      <span className="morning-row-note">
                        {[
                          task.parentTitle,
                          task.status === 'todo'
                            ? formatDaysAgo(dayOf(task.createdAt), day)
                            : chipText(task, day),
                        ]
                          .filter((v) => v !== null)
                          .join('・')}
                      </span>
                    </span>
                  </button>
                  <Button
                    kind={added ? 'primary' : 'secondary'}
                    className="morning-add"
                    aria-pressed={added}
                    onClick={() => {
                      setSelectedId(task.id);
                      toggleAddition(task.id);
                    }}
                  >
                    {added ? '今日に追加済み' : '今日へ'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="morning-actions">
          <p className="text-small reflection-notice" aria-live="polite">
            {confirm.isError
              ? `確定できませんでした（${confirm.error instanceof ApiError ? confirm.error.message : '通信に失敗しました'}）`
              : allDecided
                ? ''
                : 'すべての持ち越しを判断すると確定できます'}
          </p>
          <p className="text-small">{`今日の計画 ${plannedCount}件`}</p>
          <Button kind="confirm" disabled={!allDecided || confirm.isPending} onClick={submit}>
            計画を確定
            <Kbd tone="dark">⌘↵</Kbd>
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
