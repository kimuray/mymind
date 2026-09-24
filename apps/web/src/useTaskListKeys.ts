import { canBecomeChild, canTransition, nextOnAdvance, type Status } from '@mymind/domain';
import { ApiError } from './api/client';
import type { ListTask } from './api/tasks';
import { useKeyBindings } from './keyboard';

/** リストに表示している順の行。order は並べ替えに使う値（今日の計画は position、バックログは sortOrder） */
export type ListRow = { task: ListTask; depth: 0 | 1; order: number };

type Options = {
  rows: ListRow[];
  selectedId: string | null;
  select: (id: string | null) => void;
  /** 今日の画面では T で明日へ、バックログでは T で今日へ（DESIGN.md 5.2） */
  place: 'today' | 'backlog';
  changeStatus: (task: ListTask, to: Status) => void;
  moveTask: (task: ListTask, to: 'today' | 'tomorrow' | 'backlog') => void;
  startEdit: (id: string) => void;
  edit: (
    task: ListTask,
    change: { parentId?: string | null; order?: { in: 'plan' | 'backlog'; value: number } },
  ) => Promise<unknown>;
  notify: (message: string) => void;
};

/** 行のボタンにフォーカスを移す。Space と Enter はボタンのクリックとして状態を進める */
export function focusRow(id: string) {
  const row = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`);
  const target =
    row?.querySelector<HTMLButtonElement>('.status-icon:not(:disabled)') ??
    row?.querySelector<HTMLButtonElement>('.task-title');
  target?.focus();
}

/** 並べ替えの新しい値。移動先の隣との中間にする（整数を振り直さずに済む） */
function reorderValue(siblings: ListRow[], index: number, direction: -1 | 1): number | null {
  const target = siblings[index + direction];
  if (target === undefined) return null;
  const beyond = siblings[index + direction * 2];
  const edge = beyond?.order ?? target.order + direction;
  return (target.order + edge) / 2;
}

/** タスクのリストのキー操作（DESIGN.md 5.2、FR-U01）。今日とバックログで共通 */
export function useTaskListKeys(o: Options) {
  const index = o.rows.findIndex((r) => r.task.id === o.selectedId);
  const selected = o.rows[index];

  const moveSelection = (delta: 1 | -1) => {
    if (o.rows.length === 0) return false;
    const next = o.rows[index < 0 ? (delta === 1 ? 0 : o.rows.length - 1) : index + delta];
    if (next === undefined) return true;
    o.select(next.task.id);
    focusRow(next.task.id);
    return true;
  };

  const setStatus = (to: Status) => {
    if (selected === undefined) return false;
    if (canTransition(selected.task.status, to)) o.changeStatus(selected.task, to);
    return true;
  };

  const reorder = (direction: -1 | 1) => {
    if (selected === undefined) return false;
    const closed = (r: ListRow) => r.task.status === 'done' || r.task.status === 'cancelled';
    // 同じ親の、同じ欄（未完了か完了か）の中でだけ並べ替える
    const siblings = o.rows.filter(
      (r) =>
        r.depth === selected.depth &&
        r.task.parentId === selected.task.parentId &&
        closed(r) === closed(selected),
    );
    const value = reorderValue(siblings, siblings.indexOf(selected), direction);
    if (value !== null) {
      o.edit(selected.task, { order: { in: o.place === 'today' ? 'plan' : 'backlog', value } });
    }
    return true;
  };

  useKeyBindings({
    'list.next': () => moveSelection(1),
    'list.prev': () => moveSelection(-1),
    'list.advance': () => {
      if (selected === undefined) return false;
      const to = nextOnAdvance(selected.task.status);
      if (to !== null) o.changeStatus(selected.task, to);
      return true;
    },
    'list.pause': () => setStatus('paused'),
    'list.wait': () => setStatus('waiting'),
    'list.cancel': () => setStatus('cancelled'),
    'list.dayKey': () => {
      if (selected === undefined) return false;
      o.moveTask(selected.task, o.place === 'today' ? 'tomorrow' : 'today');
      return true;
    },
    'list.toBacklog': () => {
      if (selected === undefined || o.place === 'backlog') return false;
      o.moveTask(selected.task, 'backlog');
      return true;
    },
    'list.edit': () => {
      if (selected === undefined) return false;
      o.startEdit(selected.task.id);
      return true;
    },
    'list.indent': () => {
      if (selected === undefined || selected.task.parentId !== null) return false;
      const above = o.rows[index - 1];
      if (above === undefined) return true;
      const parentId = above.task.parentId ?? above.task.id;
      const parent = { id: parentId, parentId: null };
      const taskHasChildren = selected.task.children.total > 0;
      if (!canBecomeChild({ taskId: selected.task.id, taskHasChildren, parent })) {
        o.notify('タスクの親子は2階層までです');
        return true;
      }
      o.edit(selected.task, { parentId }).catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'DEPTH_EXCEEDED') {
          o.notify('タスクの親子は2階層までです');
        }
      });
      return true;
    },
    'list.outdent': () => {
      if (selected === undefined || selected.task.parentId === null) return false;
      o.edit(selected.task, { parentId: null });
      return true;
    },
    'list.moveUp': () => reorder(-1),
    'list.moveDown': () => reorder(1),
    escape: () => {
      if (o.selectedId === null) return false;
      o.select(null);
      return true;
    },
  });
}
