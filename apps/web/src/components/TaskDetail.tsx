import {
  canHaveChildren,
  dayOrdinalSince,
  STATUS_LABELS,
  type Status,
  type TagColor,
  TRANSITIONS,
} from '@mymind/domain';
import { useRef, useState } from 'react';
import { type ListTask, type TaskEventJson, useTaskEvents } from '../api/tasks';
import { formatShortDay } from '../day';
import { KEY_BINDINGS } from '../keymap';
import { useListMotion } from '../listMotion';
import { AddTaskInput } from './AddTaskInput';
import { Button } from './Button';
import { Kbd } from './Kbd';
import { StatusBadge } from './StatusBadge';
import { TaskMemo } from './TaskMemo';
import { TaskTags } from './TaskTags';

/** タイトルの編集のキー（キーマップの定義から出す。割り当てを変えても表示がずれない） */
const EDIT_KEY = (KEY_BINDINGS.find((b) => b.action === 'list.edit')?.keys[0] ?? '').toUpperCase();

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
  /** タイトルの編集を始める（FR-T09）。E キーと同じく、一覧の行で編集する */
  onEditTitle: () => void;
  onMove: (to: 'today' | 'tomorrow' | 'backlog') => void;
  /** 同じ画面にある、このタスクの子 */
  childTasks: readonly ListTask[];
  /** 子タスクを追加する（FR-T02）。追加先は画面で決まる（FR-T01） */
  onAddChild: (title: string) => void;
  /** メモを保存する（FR-T09）。失敗したら理由を投げる */
  onSaveNote: (noteMd: string | null) => Promise<void>;
  /** タグを名前で付ける。ない名前ならその色で作る（FR-T13）。失敗したら理由を投げる */
  onAttachTag: (name: string, color: TagColor) => Promise<void>;
  onDetachTag: (tagId: string) => void;
};

/**
 * 詳細ペインから子タスクを足せるか。子を持てるのは親を持たないタスクだけ（2階層まで、#18）。
 * 完了・中止の親には足せない。未完了の子を足すと、終わった親の下に終わっていない子ができるため（#89 で決定）
 */
export const canAddChildFromDetail = (task: Pick<ListTask, 'parentId' | 'status'>) =>
  canHaveChildren(task) && task.status !== 'done' && task.status !== 'cancelled';

/** 選択中のタスクの詳細（Figma「PC/今日」の詳細ペイン） */
export function TaskDetail({
  task,
  today,
  place,
  onTransition,
  onEditTitle,
  onMove,
  childTasks,
  onAddChild,
  onSaveNote,
  onAttachTag,
  onDetachTag,
}: TaskDetailProps) {
  const [showOthers, setShowOthers] = useState(false);
  // 詳細ペインはタスクを切り替えても同じコンポーネントのままなので、別のタスクを選んだら
  // 「その他の状態…」を閉じた状態に戻す（issue 270）。描画の途中で前のタスクと比べて戻す（effect だと、開いたまま一度描かれる）
  const [shownTaskId, setShownTaskId] = useState(task.id);
  if (shownTaskId !== task.id) {
    setShownTaskId(task.id);
    setShowOthers(false);
  }
  const events = useTaskEvents(task.id);
  // 子タスクの出入りを目で追えるようにする（DESIGN.md 4.18）。別のタスクを選んだときは動かさない
  const childList = useRef<HTMLUListElement>(null);
  useListMotion(childList, true, task.id);
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
          {/* キーを知らなくても編集を始められるようにする。編集そのものは一覧の行で行う（issue 271） */}
          <Button kind="text" className="task-detail-edit" onClick={onEditTitle}>
            <span className="task-detail-edit-label">タスク名の編集</span>
            <Kbd>{EDIT_KEY}</Kbd>
          </Button>
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

      <TaskTags key={`tags-${task.id}`} task={task} onAttach={onAttachTag} onDetach={onDetachTag} />

      {/* タスクごとに作り直す（書きかけと下書きをタスクごとに分け、選び直したときに前のタスクのメモを保存する） */}
      <TaskMemo key={task.id} task={task} onSave={onSaveNote} />

      {canHaveChildren(task) && (
        <section className="task-children-detail" aria-label="子タスク">
          <h3 className="text-label">子タスク</h3>
          {childTasks.length > 0 && (
            <ul ref={childList}>
              {childTasks.map((child) => (
                <li key={child.id} data-motion-key={child.id}>
                  <span className="chip" data-status={child.status}>
                    {STATUS_LABELS[child.status]}
                  </span>
                  <span>{child.title}</span>
                </li>
              ))}
            </ul>
          )}
          {canAddChildFromDetail(task) ? (
            <AddTaskInput
              // 打ちかけの文字を、別のタスクの欄に持ち越さない（意図しない親に子ができるため、issue 270）
              key={task.id}
              label={`「${task.title}」の子タスクを追加`}
              placeholder="子タスクを追加（Enterで確定）"
              onSubmit={onAddChild}
              isPrimary={false}
            />
          ) : (
            <p className="text-small">
              {STATUS_LABELS[task.status]}
              のタスクには子タスクを追加できません。未着手に戻すと追加できます
            </p>
          )}
        </section>
      )}

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
