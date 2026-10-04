import { isWithinGrace, nextOccurrence, type ScheduleSpec } from '@mymind/domain';
import type { Logger } from './logger';

/** 定期処理の1件。spec が null なら動かさない（設定で止めた通知など） */
export type ScheduledJob = {
  id: string;
  /** 予定。設定で変わるものがあるので、組み直すたびに読み直す */
  spec: () => ScheduleSpec | null;
  /** 予定の時刻に動かす処理。scheduledAt は、本来動かすはずだった時刻 */
  run: (scheduledAt: Date) => Promise<void> | void;
};

export type TimerHandle = { cancel: () => void };

export type SchedulerDeps = {
  now: () => Date;
  /** 予定の時刻を数えるタイムゾーン（業務日と同じ） */
  timeZone: string;
  /** タイマー。テストでは差し替える */
  setTimer?: (fn: () => void, delayMs: number) => TimerHandle;
  logger?: Logger;
  /**
   * 1回のタイマーで待つ最長の時間。macOS ではスリープ中にタイマーの経過時間が進まず、
   * 復帰後に予定より遅れて発火するので、この間隔ごとに壁時計で計算し直す
   */
  maxWaitMs?: number;
};

/** 待つ最長の時間の初期値。スリープから復帰して、過ぎた予定に気づくまでの遅れの上限になる */
export const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;

const realTimer = (fn: () => void, delayMs: number): TimerHandle => {
  const t = setTimeout(fn, delayMs);
  // タイマーだけが残っていても、プロセスの終了を妨げない
  t.unref();
  return { cancel: () => clearTimeout(t) };
};

/**
 * サーバーの中のスケジューラ（NFR-19、architecture.md 9.1、10章）。
 * 次に動かす予定の時刻に1本だけタイマーを置き、動かしたら次を計算し直す。
 * 過ぎた予定は、時刻を過ぎてから2時間以内なら動かし、それを過ぎたらその回は見送る
 */
export function createScheduler(deps: SchedulerDeps) {
  const setTimer = deps.setTimer ?? realTimer;
  const maxWait = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const entries = new Map<string, { job: ScheduledJob; next: Date | null }>();
  let timer: TimerHandle | null = null;
  let running = false;

  const plan = (job: ScheduledJob, after: Date): Date | null => {
    const spec = job.spec();
    return spec === null ? null : nextOccurrence(spec, after, deps.timeZone);
  };

  const arm = () => {
    timer?.cancel();
    timer = null;
    if (!running) return;
    const nexts = [...entries.values()].flatMap((e) => (e.next === null ? [] : [e.next]));
    if (nexts.length === 0) return;
    const earliest = Math.min(...nexts.map((d) => d.getTime()));
    const delay = Math.min(Math.max(earliest - deps.now().getTime(), 0), maxWait);
    timer = setTimer(tick, delay);
  };

  const runJob = async (job: ScheduledJob, scheduledAt: Date) => {
    try {
      await job.run(scheduledAt);
    } catch (e) {
      // 1件の失敗で、ほかの予定を止めない
      deps.logger?.error('定期処理に失敗しました', {
        job: job.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  function tick() {
    const now = deps.now();
    for (const entry of entries.values()) {
      const scheduledAt = entry.next;
      if (scheduledAt === null || scheduledAt.getTime() > now.getTime()) continue;
      // 何日も眠っていた場合も、過ぎた回をまとめて動かさず、次は今より後の回にする
      entry.next = plan(entry.job, now);
      if (isWithinGrace(scheduledAt, now)) {
        void runJob(entry.job, scheduledAt);
      } else {
        deps.logger?.info('時刻を大きく過ぎた定期処理を見送りました', {
          job: entry.job.id,
          scheduledAt: scheduledAt.toISOString(),
        });
      }
    }
    arm();
  }

  return {
    /** 予定を加える。同じ id があれば置き換える */
    add(job: ScheduledJob) {
      entries.set(job.id, { job, next: plan(job, deps.now()) });
      arm();
    },

    /** 設定が変わったときに、すべての予定を今から計算し直す */
    reschedule() {
      const now = deps.now();
      for (const entry of entries.values()) entry.next = plan(entry.job, now);
      arm();
    },

    start() {
      running = true;
      arm();
    },

    stop() {
      running = false;
      arm();
    },

    /** 次に動かす時刻（設定の画面やテストで確かめるため）。止めている予定は null */
    nextRun(id: string): Date | null {
      return entries.get(id)?.next ?? null;
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
