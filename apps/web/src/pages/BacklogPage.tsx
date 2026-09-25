import { daysBetween, nextOnAdvance, type Status } from '@mymind/domain';
import { useState } from 'react';
import {
  type ListTask,
  useBacklog,
  useCreateTask,
  useEditTask,
  useMove,
  useTransition,
} from '../api/tasks';
import { AddTaskInput } from '../components/AddTaskInput';
import { Button } from '../components/Button';
import { PageLayout } from '../components/PageLayout';
import { TaskDetail } from '../components/TaskDetail';
import { TaskRow } from '../components/TaskRow';
import { dayOf } from '../day';
import { useDayGuard } from '../dayGuard';
import { type ListRow, useTaskListKeys } from '../useTaskListKeys';

/** 最後に触れてからの日数（「3日前」）。日数は domain で数える */
function touchedAgo(task: ListTask, today: string): string {
  const days = daysBetween(dayOf(task.lastTouchedAt), today);
  return days <= 0 ? '今日' : `${days}日前`;
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
  const create = useCreateTask();
  const transition = useTransition();
  const move = useMove();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const edit = useEditTask();

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
  const detail =
    selected === undefined ? undefined : (
      <TaskDetail
        task={selected}
        today={today}
        place="backlog"
        onTransition={(to) => changeStatus(selected, to)}
        onMove={(to) => moveTask(selected, to)}
      />
    );

  return (
    <PageLayout detail={detail}>
      {guard.dialog}
      <div className="page">
        <header className="page-header">
          <h1 className="text-display">バックログ</h1>
          <p className="text-small">{`覚えておくだけのタスク ${tasks.length}`}</p>
        </header>

        <AddTaskInput
          label="バックログに追加"
          placeholder="覚えておくことを追加（Enterで確定）"
          onSubmit={(title) => create.mutate({ title, ...screen })}
        />

        {notice !== null && (
          <p className="suggestions" aria-live="polite">
            {notice}
            <Button kind="text" onClick={() => setNotice(null)}>
              閉じる
            </Button>
          </p>
        )}

        {groups.map((group) => (
          <section key={group.key} className="task-list glass-2" aria-label={group.title}>
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
                  aside={touchedAgo(task, today)}
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
        {backlog.isSuccess && tasks.length === 0 && (
          <p className="empty-note">バックログは空です</p>
        )}
      </div>
    </PageLayout>
  );
}
