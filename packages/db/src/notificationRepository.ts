import type { NotificationKind } from '@mymind/domain';
import { and, eq } from 'drizzle-orm';
import type { Database } from './client';
import { notificationsSent } from './schema';

/** 送った通知の記録（architecture.md 5章の notifications_sent）。同じ種類・同じ業務日は1回まで（FR-N04） */
export function createNotificationRepository({ db }: { db: Database }) {
  const match = (kind: NotificationKind, day: string) =>
    and(eq(notificationsSent.kind, kind), eq(notificationsSent.day, day));
  return {
    /**
     * これから送る通知を記録する。同じ種類・同じ業務日が既にあれば記録せず false を返す（送らない）。
     * 送る前に記録するのは、同時に2回動いても1回しか送らないため
     */
    claim(kind: NotificationKind, day: string, at: string): boolean {
      const result = db
        .insert(notificationsSent)
        .values({ kind, day, sentAt: at })
        .onConflictDoNothing()
        .run();
      return result.changes > 0;
    },

    /** 送れなかった通知の記録を消す（送っていない通知を、送ったことにしないため） */
    release(kind: NotificationKind, day: string): void {
      db.delete(notificationsSent).where(match(kind, day)).run();
    },

    /** その種類の通知を、その業務日に送ったか */
    wasSent(kind: NotificationKind, day: string): boolean {
      return db.select().from(notificationsSent).where(match(kind, day)).get() !== undefined;
    },
  };
}

export type NotificationRepository = ReturnType<typeof createNotificationRepository>;
