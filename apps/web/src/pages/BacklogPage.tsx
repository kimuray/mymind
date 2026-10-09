import { daysBetween, nextOnAdvance, type ReviewDecision, type Status } from '@mymind/domain';
import { type ReactNode, useRef, useState } from 'react';
import { type StaleTask, useReviewDecision, useStaleTasks } from '../api/review';
import {
  type ListTask,
  useBacklog,
  useCreateTask,
  useEditTask,
  useMove,
  useTransition,
} from '../api/tasks';
import { AddTaskInput } from '../components/AddTaskInput';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { Button } from '../components/Button';
import { Loading } from '../components/Loading';
import { PageLayout } from '../components/PageLayout';
import { NO_REVIEWS, type ReviewCounts, StocktakePanel } from '../components/StocktakePanel';
import { TaskDetail } from '../components/TaskDetail';
import { TaskRow } from '../components/TaskRow';
import { dayOf } from '../day';
import { useDayGuard } from '../dayGuard';
import { useKeyBindings } from '../keyboard';
import { useListMotion } from '../listMotion';
import { useSelectionMotion } from '../selectionMotion';
import { type ListRow, useTaskListKeys } from '../useTaskListKeys';

/** 最後に触れてからの日数（「3日前」）。日数は domain で数える */
function touchedAgo(task: ListTask, today: string): string {
  const days = daysBetween(dayOf(task.lastTouchedAt), today);
  return days <= 0 ? '今日' : `${days}日前`;
}

/** 行の右端。棚卸しの対象なら、最後に触れてからの日数のチップと「棚卸しの対象」（Figma「PC/バックログ」） */
function rowAside(task: ListTask, today: string, stale: StaleTask | undefined): ReactNode {
  if (stale === undefined) return touchedAgo(task, today);
  return (
    <>
      <span className="chip" data-status="todo">{`${stale.daysSinceTouched}日`}</span>
      棚卸しの対象
    </>
  );
}

/** 親ごとにまとめる。親のないタスクは「その他」にまとめて最後に置く（Figma「PC/バックログ」） */
function groupByParent(tasks: ListTask[]): { key: string; title: string; tasks: ListTask[] }[] {
  const groups = new Map<string, { key: string; title: string; tasks: ListTask[] }>();
  const others: ListTask[] = [];
  for (const t of tasks) {
    if (t.parentId === null || t.parentTitle === null) {
      others.push(t);
      continue;
    }
    const group = groups.get(t.parentId) ?? { key: t.parentId, title: t.parentTitle, tasks: [] };
    group.tasks.push(t);
    groups.set(t.parentId, group);
  }
  return [
    ...groups.values(),
    ...(others.length > 0 ? [{ key: 'others', title: 'その他', tasks: others }] : []),
  ];
}

/** バックログの画面（Figma「PC/バックログ」、FR-T01・FR-T05） */
export function BacklogPage() {
  // 画面が表示している業務日。業務日が変わったら操作を止めて選ばせる（NFR-14）
  const guard = useDayGuard();
  const screenDay = guard.day;
  const screen = { expectedDay: screenDay, ...(guard.allowPastDay ? { allowPastDay: true } : {}) };
  const backlog = useBacklog();
  // 行の追加・移動・並べ替えを目で追えるようにする（DESIGN.md 4.18）
  const listRoot = useRef<HTMLDivElement>(null);
  useListMotion(listRoot, backlog.isSuccess);
  // 選択の面を行から行へ滑らせる（DESIGN.md 5.2）
  useSelectionMotion(listRoot);
  const create = useCreateTask();
  const transition = useTransition();
  const move = useMove();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const edit = useEditTask();
  const staleTasks = useStaleTasks();
  const review = useReviewDecision();
  // この画面を開いてから判断した件数（棚卸しの進み具合とまとめ）
  const [reviewed, setReviewed] = useState<ReviewCounts>(NO_REVIEWS);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const today = backlog.data?.today ?? screenDay;
  const tasks = backlog.data?.tasks ?? [];
  const selected = tasks.find((t) => t.id === selectedId);

  const changeStatus = (task: ListTask, to: Status) => transition.mutate({ task, to, ...screen });
  const moveTask = (task: ListTask, to: 'today' | 'tomorrow' | 'backlog') =>
    move.mutate({ task, to, ...screen }, { onSuccess: () => setSelectedId(null) });
  const groups = groupByParent(tasks);
  const rows: ListRow[] = groups.flatMap((g) =>
    g.tasks.map((task) => ({ task, depth: 0 as const, order: task.sortOrder })),
  );
  useTaskListKeys({
    rows,
    selectedId,
    select: setSelectedId,
    place: 'backlog',
    changeStatus,
    moveTask,
    startEdit: setEditingId,
    edit: (task, change) => edit.mutateAsync({ task, ...screen, ...change }),
    notify: setNotice,
  });
  const stale = staleTasks.data?.tasks ?? [];
  const staleById = new Map(stale.map((t) => [t.id, t]));
  // タスクを選んでいなければ、詳細ペインに棚卸しを出す（対象がなく、まだ何も判断していなければ出さない）
  const showStocktake =
    selected === undefined &&
    (stale.length > 0 || reviewed.this_week + reviewed.keep + reviewed.drop > 0);
  const decide = (task: StaleTask, decision: ReviewDecision) => {
    if (review.isPending) return;
    setReviewError(null);
    review.mutate(
      { task, decision, ...screen },
      {
        onSuccess: () => setReviewed((r) => ({ ...r, [decision]: r[decision] + 1 })),
        onError: (e) => setReviewError(`判断を反映できませんでした（${e.message}）`),
      },
    );
  };
  const decideCurrent = (decision: ReviewDecision) => {
    const current = stale[0];
    if (!showStocktake || current === undefined) return false;
    decide(current, decision);
    return true;
  };
  // 5.3 棚卸しの判断（1：今週やる、2：残す、3：中止）
  useKeyBindings({
    'decide.first': () => decideCurrent('this_week'),
    'decide.second': () => decideCurrent('keep'),
    'decide.third': () => decideCurrent('drop'),
  });

  const detail = showStocktake ? (
    <StocktakePanel
      tasks={stale}
      afterDays={staleTasks.data?.afterDays ?? 0}
      reviewed={reviewed}
      onDecide={decide}
      busy={review.isPending}
      error={reviewError}
    />
  ) : selected === undefined ? undefined : (
    <TaskDetail
      task={selected}
      today={today}
      place="backlog"
      onTransition={(to) => changeStatus(selected, to)}
      onMove={(to) => moveTask(selected, to)}
      childTasks={tasks.filter((t) => t.parentId === selected.id)}
      onAddChild={(title) => create.mutate({ title, parentId: selected.id, ...screen })}
      onSaveNote={async (noteMd) => {
        await edit.mutateAsync({ task: selected, noteMd, ...screen });
      }}
    />
  );

  return (
    <PageLayout detail={detail} detailKey={selected?.id ?? null}>
      {guard.dialog}
      <div className="page" ref={listRoot}>
        <header className="page-header">
          <h1 className="text-display">バックログ</h1>
          {/* 読み込みの前後で作り直す。読み込み中の 0 から届いた件数へ変わるのを「増えた」として動かさない（DESIGN.md 4.20） */}
          <p className="text-small" key={backlog.isSuccess ? 'loaded' : 'loading'}>
            覚えておくだけのタスク <AnimatedNumber value={tasks.length} />
          </p>
        </header>

        <AddTaskInput
          label="バックログに追加"
          placeholder="覚えておくことを追加（Enterで確定）"
          onSubmit={(title) => create.mutate({ title, ...screen })}
        />

        {/* 通知・グループの面・空の案内も出入りと押し下げを動かす（DESIGN.md 4.18、FR-T06）。key はタスクの ID とぶつからない名前にする */}
        {notice !== null && (
          <p className="suggestions" aria-live="polite" data-motion-key="ui:notice">
            {notice}
            <Button kind="text" onClick={() => setNotice(null)}>
              閉じる
            </Button>
          </p>
        )}

        {groups.map((group) => (
          <section
            key={group.key}
            className="task-list glass-2"
            aria-label={group.title}
            data-motion-key={`ui:group:${group.key}`}
          >
            <h2 className="text-label">{group.title}</h2>
            <ul>
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={today}
                  depth={0}
                  showParent={false}
                  selected={task.id === selectedId}
                  onSelect={() => setSelectedId(task.id)}
                  onAdvance={() => {
                    const to = nextOnAdvance(task.status);
                    if (to !== null) changeStatus(task, to);
                  }}
                  aside={rowAside(task, today, staleById.get(task.id))}
                  editing={task.id === editingId}
                  onEditEnd={(title) => {
                    setEditingId(null);
                    if (title !== null) edit.mutate({ task, title, ...screen });
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
        {backlog.isPending && <Loading />}
        {backlog.isSuccess && tasks.length === 0 && (
          <p className="empty-note" data-motion-key="ui:empty">
            バックログは空です
          </p>
        )}
      </div>
    </PageLayout>
  );
}
