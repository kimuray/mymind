import { dayOrdinalSince, STATUS_LABELS, type Status, TRANSITIONS } from '@mymind/domain';
import { useState } from 'react';
import { type ListTask, type TaskEventJson, useTaskEvents } from '../api/tasks';
import { formatShortDay } from '../day';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';

/** 詳細ペインの主な操作。状態ごとに、次にとる自然な操作を1つ選ぶ */
const PRIMARY: Readonly<Record<Status, { to: Status; label: string }>> = {
  todo: { to: 'doing', label: '着手する' },
  doing: { to: 'done', label: '完了にする' },
  paused: { to: 'doing', label: '再開する' },
  waiting: { to: 'doing', label: '再開する' },
  done: { to: 'todo', label: '未着手に戻す' },
  cancelled: { to: 'todo', label: '未着手に戻す' },
};

function describeEvent(e: TaskEventJson): string {
  switch (e.type) {
    case 'created':
      return '作成';
    case 'planned':
      return '計画に入れた';
    case 'unplanned':
      return '計画から外した';
    case 'edited':
      return '編集';
    case 'status_changed':
      return `${STATUS_LABELS[e.from]} → ${STATUS_LABELS[e.to]}`;
    case 'completion_undone':
      return `完了を取り消し（${STATUS_LABELS[e.to]}へ）`;
  }
}

type TaskDetailProps = {
  task: ListTask;
  today: string;
  /** 今日の画面では「明日へ」「バックログへ」、バックログでは「今日へ」「明日へ」を出す */
  place: 'today' | 'backlog';
  onTransition: (to: Status) => void;
  onMove: (to: 'today' | 'tomorrow' | 'backlog') => void;
};

/** 選択中のタスクの詳細（Figma「PC/今日」の詳細ペイン） */
export function TaskDetail({ task, today, place, onTransition, onMove }: TaskDetailProps) {
  const [showOthers, setShowOthers] = useState(false);
  const events = useTaskEvents(task.id);
  const primary = PRIMARY[task.status];
  const others = TRANSITIONS[task.status].filter((s) => s !== primary.to);
  const inProgress =
    task.status === 'doing' || task.status === 'paused' || task.status === 'waiting';

  return (
    <div className="task-detail">
      <header className="task-detail-head">
        {task.parentTitle !== null && <p className="task-detail-parent">{task.parentTitle} ›</p>}
        <h2 className="text-title">{task.title}</h2>
        <div className="task-detail-status">
          <StatusBadge status={task.status} since={task.statusSince} today={today} />
          {inProgress && (
            <span className="text-small">
              {STATUS_LABELS[task.status]}から{dayOrdinalSince(task.statusSince, today)}日目
            </span>
          )}
        </div>
      </header>

      <div className="task-detail-actions">
        <Button kind="primary" onClick={() => onTransition(primary.to)}>
          {primary.label}
        </Button>
        <Button aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}>
          その他の状態…
        </Button>
      </div>
      {showOthers && (
        <ul className="task-detail-others" aria-label="その他の状態">
          {others.map((to) => (
            <li key={to}>
              <Button kind="text" onClick={() => onTransition(to)}>
                {STATUS_LABELS[to]}にする
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="task-detail-moves">
        {place === 'backlog' && <Button onClick={() => onMove('today')}>今日へ</Button>}
        <Button onClick={() => onMove('tomorrow')}>明日へ</Button>
        {place === 'today' && <Button onClick={() => onMove('backlog')}>バックログへ</Button>}
      </div>

      <section className="task-history" aria-label="状態の履歴">
        <h3 className="text-label">状態の履歴</h3>
        <ol>
          {[...(events.data?.events ?? [])].reverse().map((e) => (
            // イベントは ID を返さないので、時刻・種類・業務日の組で区別する
            <li key={`${e.at}-${e.type}-${e.day}`}>
              <span className="task-history-dot" aria-hidden="true" />
              <span className="task-history-day">{formatShortDay(e.day)}</span>
              <span>{describeEvent(e)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
