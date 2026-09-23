import { canTransition, isCompletionUndo, type Status } from './status';

/** イベントに共通する項目。at は UTC の ISO 文字列、day は toBusinessDay で求めた業務日 */
type EventBase = { taskId: string; at: string; day: string };

/**
 * タスクの履歴の正本になるイベント（ADR-0004、architecture.md 5章 task_events）。
 * ステータスが変わるイベントだけが from / to を持つ。
 */
export type TaskEvent =
  | (EventBase & { type: 'created' })
  | (EventBase & { type: 'status_changed'; from: Status; to: Status })
  | (EventBase & { type: 'completion_undone'; from: 'done'; to: Status })
  | (EventBase & { type: 'planned' })
  | (EventBase & { type: 'unplanned' })
  | (EventBase & { type: 'edited' });

export type StatusChangeEvent = Extract<
  TaskEvent,
  { type: 'status_changed' | 'completion_undone' }
>;

export type ChangeStatusError = { kind: 'invalid_transition'; from: Status; to: Status };

/**
 * ステータスの変更を、遷移表に照らしてイベントにする（FR-T03、FR-T04）。
 * 完了からの遷移は、完了の取り消しとして別の種類のイベントにする（architecture.md 4.2）。
 */
export function changeStatus(
  input: EventBase & { from: Status; to: Status },
): { ok: true; value: StatusChangeEvent } | { ok: false; error: ChangeStatusError } {
  const { taskId, at, day, from, to } = input;
  if (!canTransition(from, to)) {
    return { ok: false, error: { kind: 'invalid_transition', from, to } };
  }
  if (from === 'done' && isCompletionUndo(from, to)) {
    return { ok: true, value: { type: 'completion_undone', taskId, at, day, from, to } };
  }
  return { ok: true, value: { type: 'status_changed', taskId, at, day, from, to } };
}
