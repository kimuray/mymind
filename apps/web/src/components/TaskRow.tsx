import type { ReactNode } from 'react';
import { useState } from 'react';
import type { ListTask } from '../api/tasks';
import { useStatusChanged } from '../statusChange';
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
  aside?: ReactNode;
  /** タイトルを編集中か（E キー） */
  editing?: boolean;
  onEditEnd?: (title: string | null) => void;
};

/** タイトルの編集欄。Enter で確定、Esc で取り消す（変換中の Enter では確定しない） */
function TitleEditor({
  initial,
  onEnd,
}: {
  initial: string;
  onEnd: (title: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="task-title-input"
      aria-label="タイトルを編集"
      value={value}
      // 編集を始めたらすぐ入力できるようにする（E キーで開くため）
      // biome-ignore lint/a11y/noAutofocus: キー操作で編集欄を開いたときに、続けて入力できるようにする
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onEnd(null)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          const trimmed = value.trim();
          onEnd(trimmed === '' || trimmed === initial ? null : trimmed);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onEnd(null);
        }
      }}
    />
  );
}

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
  editing = false,
  onEditEnd,
}: TaskRowProps) {
  const closed = task.status === 'done' || task.status === 'cancelled';
  // 状態が変わった直後だけ、アイコン・取り消し線・バッジに動きを付ける（DESIGN.md 4.2）
  const changed = useStatusChanged(task.id, task.status);
  return (
    <li
      className="task-row"
      data-task-id={task.id}
      data-depth={depth}
      data-selected={selected}
      data-closed={closed}
      data-changed={changed}
    >
      <StatusIcon title={task.title} status={task.status} onAdvance={onAdvance} animate={changed} />
      {editing ? (
        <TitleEditor initial={task.title} onEnd={(title) => onEditEnd?.(title)} />
      ) : (
        <button type="button" className="task-title" aria-pressed={selected} onClick={onSelect}>
          <span className="task-name">{task.title}</span>
          {showParent && depth === 0 && task.parentTitle !== null && (
            <span className="task-parent">{task.parentTitle}</span>
          )}
        </button>
      )}
      {task.children.total > 0 && (
        <span className="task-children">{`子 ${task.children.closed}/${task.children.total}`}</span>
      )}
      <StatusBadge status={task.status} since={task.statusSince} today={today} animate={changed} />
      {aside !== undefined && <span className="task-aside">{aside}</span>}
    </li>
  );
}
