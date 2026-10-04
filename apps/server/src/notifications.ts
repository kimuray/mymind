import type {
  DailyLogRepository,
  JobRepository,
  NotificationRepository,
  TaskRepository,
} from '@mymind/db';
import {
  type BusinessDayOptions,
  composeEvening,
  composeInventory,
  composeMorning,
  type DaySummary,
  DEFAULT_NOTIFICATION_SCHEDULES,
  type LingeringTask,
  LONG_WAITING_DAYS,
  NOTIFICATION_KINDS,
  type Notification,
  type NotificationKind,
  previousDays,
  type ScheduleSpec,
  toBusinessDay,
} from '@mymind/domain';
import { findCarryover, hasReflection, listReviewTargets, summarizeDayOf } from './dayRecords';
import type { Logger } from './logger';
import type { ScheduledJob } from './scheduler';

/**
 * 通知を出す口（FR-N05 の通知のアダプタ。macOS の通知、ブラウザの通知などは issue 169 で作る）。
 * 出せなかったときは理由を返す
 */
export type NotificationAdapter = {
  notify: (notification: Notification) => Promise<{ ok: true } | { ok: false; message: string }>;
};

export type NotificationDeps = {
  tasks: TaskRepository;
  logs: Pick<DailyLogRepository, 'find'>;
  jobs: Pick<JobRepository, 'latestDailyFeedbackBefore'>;
  sent: NotificationRepository;
  adapter: NotificationAdapter;
  /** 棚卸しの対象にする日数（設定、FR-R06） */
  reviewAfterDays: () => number;
  /** 種類ごとの予定。null なら送らない（設定で止めた通知、FR-N04）。省くと初期値 */
  schedule?: (kind: NotificationKind) => ScheduleSpec | null;
  dayOptions: BusinessDayOptions;
  now: () => Date;
  logger: Logger;
};

/** 夜の通知に入れる、長引いているタスク。記録のまとめ（FR-D07）の「待ちが継続」と、前から着手中で同じ日数以上のもの */
function lingeringOf(summary: DaySummary): LingeringTask[] {
  return [
    ...summary.changes.flatMap((c) =>
      c.kind === 'waiting_continues'
        ? [{ title: c.title, status: 'waiting' as const, dayOrdinal: c.dayOrdinal }]
        : [],
    ),
    ...summary.started
      .filter((s) => !s.isNew && s.dayOrdinal >= LONG_WAITING_DAYS)
      .map((s) => ({ title: s.title, status: 'doing' as const, dayOrdinal: s.dayOrdinal })),
  ];
}

/** その業務日の事実を集めて、送る通知を決める。送らないときは null。件数や日数はここで数える（FR-A10） */
export function composeNotification(
  deps: NotificationDeps,
  kind: NotificationKind,
  day: string,
): Notification | null {
  switch (kind) {
    case 'morning': {
      const yesterday = previousDays(day, 1)[0];
      return composeMorning({
        isPlanConfirmed: deps.logs.find(day)?.planConfirmedAt != null,
        hasYesterdayFeedback: deps.jobs.latestDailyFeedbackBefore(day)?.period === yesterday,
        carryoverCount: findCarryover(deps.tasks, day).candidates.length,
      });
    }
    case 'evening': {
      const summary = summarizeDayOf(deps.tasks, day);
      return composeEvening({
        isReflectionSaved: hasReflection(deps.logs.find(day)),
        completedCount: summary.completed.length,
        lingering: lingeringOf(summary),
      });
    }
    case 'inventory': {
      const afterDays = deps.reviewAfterDays();
      return composeInventory({
        targetCount: listReviewTargets(deps.tasks, day, afterDays, deps.dayOptions).length,
        afterDays,
      });
    }
  }
}

/**
 * 1つの種類の通知を、予定の時刻の業務日について送る。条件を満たさないとき、その日に送ったときは送らない（FR-N04）。
 * 送る前に記録し、出せなかったら記録を消す（送っていない通知を、送ったことにしないため）
 */
export async function sendNotification(
  deps: NotificationDeps,
  kind: NotificationKind,
  scheduledAt: Date,
): Promise<void> {
  // 復帰が遅れて日付をまたいでも、予定の時刻の業務日について判断する
  const day = toBusinessDay(scheduledAt, deps.dayOptions);
  if (deps.sent.wasSent(kind, day)) return;
  const notification = composeNotification(deps, kind, day);
  if (notification === null) {
    deps.logger.info('条件を満たさないので通知を送りませんでした', { kind, day });
    return;
  }
  if (!deps.sent.claim(kind, day, deps.now().toISOString())) return;
  const result = await deps.adapter.notify(notification).catch((e: unknown) => ({
    ok: false as const,
    message: e instanceof Error ? e.message : String(e),
  }));
  if (result.ok) {
    deps.logger.info('通知を送りました', { kind, day });
  } else {
    deps.sent.release(kind, day);
    deps.logger.error('通知を出せませんでした', { kind, day, error: result.message });
  }
}

/** 朝・夜・棚卸しの通知の予定（FR-N01〜N03、architecture.md 9.1）。スケジューラに加えて使う */
export function createNotificationJobs(deps: NotificationDeps): ScheduledJob[] {
  const schedule = deps.schedule ?? ((kind) => DEFAULT_NOTIFICATION_SCHEDULES[kind]);
  return NOTIFICATION_KINDS.map((kind) => ({
    id: `notification-${kind}`,
    spec: () => schedule(kind),
    run: (scheduledAt) => sendNotification(deps, kind, scheduledAt),
  }));
}

/**
 * 通知をログに残すだけのアダプタ。OS の通知を出すアダプタ（issue 169）ができるまでの間、条件の判断と記録を動かすために使う。
 * 通知文はタスク名を含むので、ログには種類と画面だけを残す
 */
export function createLogOnlyNotificationAdapter(logger: Logger): NotificationAdapter {
  return {
    notify: async (notification) => {
      logger.info('通知（OS の通知を出すアダプタはまだありません）', {
        kind: notification.kind,
        path: notification.path,
      });
      return { ok: true };
    },
  };
}
