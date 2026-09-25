import { canTransition, nextOnAdvance, type Status } from '@mymind/domain';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type ListTask,
  type Suggestion,
  useCreateTask,
  useDayPlan,
  useEditTask,
  useMove,
  useTransition,
} from '../api/tasks';
import { AddTaskInput } from '../components/AddTaskInput';
import { Button } from '../components/Button';
import { Kbd } from '../components/Kbd';
import { PageLayout } from '../components/PageLayout';
import { CountChip } from '../components/StatusBadge';
import { TaskDetail } from '../components/TaskDetail';
import { TaskRow } from '../components/TaskRow';
import { formatDayHeading } from '../day';
import { useDayGuard } from '../dayGuard';
import { LIST_HINTS, NAVIGATION_KEYS } from '../keymap';
import { type ListRow, useTaskListKeys } from '../useTaskListKeys';

const isClosed = (s: Status) => s === 'done' || s === 'cancelled';

/** 子を親のすぐ下に並べる。親が今日の計画にない子は、そのまま上の階層に置く */
function orderWithChildren(tasks: ListTask[]): { task: ListTask; depth: 0 | 1 }[] {
  const ids = new Set(tasks.map((t) => t.id));
  const top = tasks.filter((t) => t.parentId === null || !ids.has(t.parentId));
  return top.flatMap((t) => [
    { task: t, depth: 0 as const },
    ...tasks.filter((c) => c.parentId === t.id).map((c) => ({ task: c, depth: 1 as const })),
  ]);
}

/** 今日の画面（Figma「PC/今日」、FR-T01・FR-T03・FR-T05・FR-T12） */
export function TodayPage() {
  // 画面が表示している業務日。業務日の切り替え検知（NFR-14）は別の issue で加える
  // 画面が表示している業務日。業務日が変わったら操作を止めて選ばせる（NFR-14）
  const guard = useDayGuard();
  const day = guard.day;
  const screen = { expectedDay: day, ...(guard.allowPastDay ? { allowPastDay: true } : {}) };
  const plan = useDayPlan(day);
  const create = useCreateTask();
  const transition = useTransition();
  const move = useMove();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const edit = useEditTask();

  const tasks = plan.data?.tasks ?? [];
  const open = tasks.filter((t) => !isClosed(t.status));
  const closed = tasks.filter((t) => isClosed(t.status));
  const selected = tasks.find((t) => t.id === selectedId);
  const count = (s: Status) => tasks.filter((t) => t.status === s).length;
  const positions = new Map((plan.data?.tasks ?? []).map((t) => [t.id, t.position]));
  const openRows = orderWithChildren(open);
  // キー操作で移動する順（未完了の欄、完了の欄の順）
  const rows: ListRow[] = [...openRows, ...closed.map((task) => ({ task, depth: 0 as const }))].map(
    (r) => ({ ...r, order: positions.get(r.task.id) ?? 0 }),
  );
  const heading = formatDayHeading(day);

  const changeStatus = (task: ListTask, to: Status) =>
    transition.mutate(
      { task, to, ...screen },
      { onSuccess: (res) => setSuggestions(res.suggestions) },
    );
  const advance = (task: ListTask) => {
    const to = nextOnAdvance(task.status);
    if (to !== null) changeStatus(task, to);
  };
  const moveTask = (task: ListTask, to: 'today' | 'tomorrow' | 'backlog') =>
    move.mutate(
      { task, to, ...screen },
      {
        onSuccess: (res) => {
          setSuggestions(res.suggestions);
          if (to !== 'today') setSelectedId(null);
        },
      },
    );

  useTaskListKeys({
    rows,
    selectedId,
    select: setSelectedId,
    place: 'today',
    changeStatus,
    moveTask,
    startEdit: setEditingId,
    edit: (task, change) => edit.mutateAsync({ task, ...screen, ...change }),
    notify: setNotice,
  });
  const endEdit = (task: ListTask) => (title: string | null) => {
    setEditingId(null);
    if (title !== null) edit.mutate({ task, title, ...screen });
  };

  const detail =
    selected === undefined ? undefined : (
      <TaskDetail
        task={selected}
        today={day}
        place="today"
        onTransition={(to) => changeStatus(selected, to)}
        onMove={(to) => moveTask(selected, to)}
      />
    );

  return (
    <PageLayout detail={detail}>
      {guard.dialog}
      <div className="page">
        <header className="page-header">
          <div className="page-title">
            <h1 className="text-display">
              {heading.date}
              <span className="page-weekday">{heading.weekday}</span>
            </h1>
            <div className="chips">
              <CountChip status="doing">{`着手中 ${count('doing')}`}</CountChip>
              <CountChip status="todo">{`未着手 ${count('todo')}`}</CountChip>
              <CountChip status="done">{`完了 ${count('done')}`}</CountChip>
            </div>
          </div>
          <Link
            to="/reflection/{-$day}"
            params={{ day: undefined }}
            className="button button-primary"
          >
            振り返りを書く
            <Kbd tone="dark">{NAVIGATION_KEYS.reflection.join(' ')}</Kbd>
          </Link>
        </header>

        <AddTaskInput
          label="今日のタスクを追加"
          placeholder="今日のタスクを追加（Enterで確定）"
          onSubmit={(title) => create.mutate({ title, planFor: 'today', ...screen })}
        />

        {notice !== null && (
          <p className="suggestions" aria-live="polite">
            {notice}
            <Button kind="text" onClick={() => setNotice(null)}>
              閉じる
            </Button>
          </p>
        )}

        <SuggestionBar
          suggestions={suggestions}
          tasks={tasks}
          onTransition={changeStatus}
          onDismiss={() => setSuggestions([])}
        />

        {open.length > 0 && (
          <ul className="task-list glass-2" aria-label="今日やること">
            {openRows.map(({ task, depth }) => (
              <TaskRow
                key={task.id}
                task={task}
                today={day}
                depth={depth}
                selected={task.id === selectedId}
                onSelect={() => setSelectedId(task.id)}
                onAdvance={() => advance(task)}
                editing={task.id === editingId}
                onEditEnd={endEdit(task)}
              />
            ))}
          </ul>
        )}
        {plan.isSuccess && tasks.length === 0 && (
          <p className="empty-note">今日の計画はまだありません。上の欄からタスクを追加できます</p>
        )}

        {closed.length > 0 && (
          <section className="task-list task-list-closed glass-2" aria-label="完了">
            <h2 className="text-label">完了</h2>
            <ul>
              {closed.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  today={day}
                  depth={0}
                  selected={task.id === selectedId}
                  onSelect={() => setSelectedId(task.id)}
                  onAdvance={() => advance(task)}
                  editing={task.id === editingId}
                  onEditEnd={endEdit(task)}
                />
              ))}
            </ul>
          </section>
        )}

        <p className="key-hints">
          {LIST_HINTS.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </p>
      </div>
    </PageLayout>
  );
}

/** 自動ルールの提案（FR-T06 の取り消し、FR-T08 の親の完了）。提案は選ばれたときだけ実行する */
function SuggestionBar({
  suggestions,
  tasks,
  onTransition,
  onDismiss,
}: {
  suggestions: Suggestion[];
  tasks: ListTask[];
  onTransition: (task: ListTask, to: Status) => void;
  onDismiss: () => void;
}) {
  const items = suggestions.flatMap((s) => {
    const id = s.kind === 'complete_parent' ? s.parentId : s.taskId;
    const task = tasks.find((t) => t.id === id);
    if (task === undefined) return [];
    if (s.kind === 'complete_parent' && canTransition(task.status, 'done')) {
      return [
        {
          key: `${s.kind}-${id}`,
          text: `「${task.title}」の子タスクがすべて終わりました`,
          action: '親を完了にする',
          run: () => onTransition(task, 'done'),
        },
      ];
    }
    if (s.kind === 'undo_auto_pause' && task.status === 'paused') {
      return [
        {
          key: `${s.kind}-${id}`,
          text: `「${task.title}」を中断にしました`,
          action: '取り消す',
          run: () => onTransition(task, 'doing'),
        },
      ];
    }
    return [];
  });
  if (items.length === 0) return null;
  return (
    <div className="suggestions" aria-live="polite">
      {items.map((item) => (
        <p key={item.key} className="suggestion">
          <span>{item.text}</span>
          <Button
            kind="text"
            onClick={() => {
              item.run();
              onDismiss();
            }}
          >
            {item.action}
          </Button>
        </p>
      ))}
      <Button kind="text" onClick={onDismiss}>
        閉じる
      </Button>
    </div>
  );
}
