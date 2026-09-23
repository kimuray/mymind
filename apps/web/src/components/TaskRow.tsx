import type { ListTask } from '../api/tasks';
import { StatusBadge } from './StatusBadge';
import { StatusIcon } from './StatusIcon';

type TaskRowProps = {
  task: ListTask;
  today: string;
  /** 1 なら子タスクとして字下げする（親子は2階層まで、FR-T02） */
  depth: 0 | 1;
  selected: boolean;
  onSelect: () => void;
  onAdvance: () => void;
  /** 親が同じ一覧にないとき、親の名前をラベルとして出す */
  showParent?: boolean;
  /** 行の右端に出す補足（バックログの「3日前」など） */
  aside?: string;
};

/** タスクの行（Figma「PC/今日」のリストの行）。backdrop-filter は付けない（ui.md） */
export function TaskRow({
  task,
  today,
  depth,
  selected,
  onSelect,
  onAdvance,
  showParent = true,
  aside,
}: TaskRowProps) {
  const closed = task.status === 'done' || task.status === 'cancelled';
  return (
    <li className="task-row" data-depth={depth} data-selected={selected} data-closed={closed}>
      <StatusIcon title={task.title} status={task.status} onAdvance={onAdvance} />
      <button type="button" className="task-title" aria-pressed={selected} onClick={onSelect}>
        <span className="task-name">{task.title}</span>
        {showParent && depth === 0 && task.parentTitle !== null && (
          <span className="task-parent">{task.parentTitle}</span>
        )}
      </button>
      {task.children.total > 0 && (
        <span className="task-children">{`子 ${task.children.closed}/${task.children.total}`}</span>
      )}
      <StatusBadge status={task.status} since={task.statusSince} today={today} />
      {aside !== undefined && <span className="task-aside">{aside}</span>}
    </li>
  );
}
