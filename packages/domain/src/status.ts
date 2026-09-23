export const STATUSES = ['todo', 'doing', 'paused', 'waiting', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

/** 遷移表（docs/architecture.md 4.2） */
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  todo: ['doing', 'cancelled'],
  doing: ['done', 'paused', 'waiting', 'cancelled'],
  paused: ['doing', 'done', 'cancelled'],
  waiting: ['doing', 'done', 'cancelled'],
  done: ['doing', 'todo'],
  cancelled: ['todo'],
};

export const STATUS_LABELS: Readonly<Record<Status, string>> = {
  todo: '未着手',
  doing: '着手中',
  paused: '中断',
  waiting: '待ち',
  done: '完了',
  cancelled: '中止',
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Space キー（状態を進める）で次に移る状態。進められない場合は null */
export function nextOnAdvance(status: Status): Status | null {
  switch (status) {
    case 'todo':
      return 'doing';
    case 'doing':
      return 'done';
    case 'paused':
    case 'waiting':
      return 'doing';
    case 'done':
      return 'todo';
    case 'cancelled':
      return null;
  }
}

/** 完了の取り消しにあたる遷移か */
export function isCompletionUndo(from: Status, to: Status): boolean {
  return from === 'done' && (to === 'todo' || to === 'doing');
}
