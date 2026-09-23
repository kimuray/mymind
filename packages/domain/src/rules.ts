import type { Status } from './status';
import { changeStatus, type StatusChangeEvent } from './taskEvents';

/** ルールの判定に使うタスクの状態 */
export type TaskSnapshot = { id: string; parentId: string | null; status: Status };

/** イベントの時刻と業務日。呼び出し側が現在時刻から求めて渡す */
export type RuleContext = { at: string; day: string };

/** 画面に出す提案。ユーザーが選んだときだけ、別の操作として実行する */
export type Suggestion =
  | { kind: 'undo_auto_pause'; taskId: string }
  | { kind: 'complete_parent'; parentId: string };

/** 自動ルールの結果。サーバーは events を操作のイベントと一緒に保存し、suggestions を応答に含める */
export type RuleOutcome = { events: StatusChangeEvent[]; suggestions: Suggestion[] };

const NONE: RuleOutcome = { events: [], suggestions: [] };

const isClosed = (status: Status) => status === 'done' || status === 'cancelled';

/** 遷移表で許される変更だけをイベントにする。ルールの条件で遷移の可否は確かめてあるので、失敗はプログラムの誤り */
function autoEvent(taskId: string, from: Status, to: Status, ctx: RuleContext) {
  const result = changeStatus({ taskId, from, to, ...ctx });
  if (!result.ok) throw new Error(`自動ルールが遷移できない変更を作りました: ${from} → ${to}`);
  return result.value;
}

/**
 * タスクをバックログへ移したとき（FR-T06）。
 * 着手中のまま計画から外れると、手を止めたことが記録に残らないので、中断にして取り消しを提案する。
 */
export function rulesOnMoveToBacklog(task: TaskSnapshot, ctx: RuleContext): RuleOutcome {
  if (task.status !== 'doing') return NONE;
  return {
    events: [autoEvent(task.id, 'doing', 'paused', ctx)],
    suggestions: [{ kind: 'undo_auto_pause', taskId: task.id }],
  };
}

export type StatusChangeInput = {
  /** ステータスを変えた子タスク（変更後の状態） */
  task: TaskSnapshot;
  /** 変えたタスクの親。親がなければ null */
  parent: TaskSnapshot | null;
  /** 親のほかの子タスク（変えたタスクを含まない） */
  siblings: TaskSnapshot[];
};

/**
 * タスクのステータスを変えたとき。
 * 子の着手で未着手の親を着手中にし（FR-T07）、子がすべて終わったら親の完了を提案する（FR-T08）。
 * 親の完了は、子の終わり方を見てユーザーが決めるので、自動では完了にしない。
 */
export function rulesOnStatusChange(input: StatusChangeInput, ctx: RuleContext): RuleOutcome {
  const { task, parent, siblings } = input;
  if (parent === null) return NONE;

  if (task.status === 'doing' && parent.status === 'todo') {
    return { events: [autoEvent(parent.id, 'todo', 'doing', ctx)], suggestions: [] };
  }

  const allChildrenClosed = isClosed(task.status) && siblings.every((s) => isClosed(s.status));
  if (allChildrenClosed && !isClosed(parent.status)) {
    return { events: [], suggestions: [{ kind: 'complete_parent', parentId: parent.id }] };
  }
  return NONE;
}
