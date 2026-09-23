import type { TaskEvent } from './taskEvents';

export type MoveTarget = 'today' | 'tomorrow' | 'backlog';

/** YYYY-MM-DD の翌日。暦の計算だけなのでタイムゾーンに依存しない */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    throw new RangeError(`業務日の形式ではありません: ${day}`);
  }
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export type PlanChange = {
  /** 計画から外す業務日 */
  removeDays: string[];
  /** 計画に入れる業務日。入れない（バックログへ）か、すでに入っていれば null */
  addDay: string | null;
  events: Extract<TaskEvent, { type: 'planned' | 'unplanned' }>[];
};

/**
 * タスクを「今日」「明日」「バックログ」へ移す（FR-T05）。
 * 今日以降の計画だけを動かし、過去の計画は記録として残す。
 * バックログは「今日以降の計画に入っていない」状態なので、今日以降の計画から外すだけで表せる。
 */
export function planMove(input: {
  taskId: string;
  /** タスクが入っている計画の業務日（過去を含む） */
  plannedDays: string[];
  /** 画面が表示している業務日 */
  today: string;
  target: MoveTarget;
  at: string;
}): PlanChange {
  const { taskId, today, target, at } = input;
  const targetDay = target === 'today' ? today : target === 'tomorrow' ? nextDay(today) : null;
  const upcoming = input.plannedDays.filter((d) => d >= today);
  const removeDays = upcoming.filter((d) => d !== targetDay).sort();
  const addDay = targetDay !== null && !upcoming.includes(targetDay) ? targetDay : null;
  // task_events には入れた先・外した元の業務日を持つ列がないため、イベントには操作した業務日だけを記録する
  const base = { taskId, at, day: today };
  return {
    removeDays,
    addDay,
    events: [
      ...removeDays.map(() => ({ type: 'unplanned' as const, ...base })),
      ...(addDay === null ? [] : [{ type: 'planned' as const, ...base }]),
    ],
  };
}

/** 親子は2階層まで（FR-T02）。子を持てるのは、親を持たないタスクだけ */
export function canHaveChildren(task: { parentId: string | null }): boolean {
  return task.parentId === null;
}
