/** エージェントのジョブの状態（architecture.md 5章 agent_jobs、7.1） */
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_KINDS = ['daily_feedback', 'monthly_summary'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

/** ジョブの状態を変えられるか。終わったジョブ（成功・失敗・キャンセル）は変えない。再試行は新しいジョブにする */
export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

/** まだ終わっていない（画面に「生成中」を出す）ジョブか */
export function isJobActive(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}
