import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { dailyLogs } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

export type DailyLog = {
  day: string;
  thoughtsMd: string;
  learningMd: string;
  planConfirmedAt: string | null;
  updatedAt: string;
};

/**
 * 業務日ごとの振り返り（architecture.md 5章の daily_logs）。
 * 本文は機微データなので、保存と読み出しで必ず SensitiveCodec を通す（ADR-0009）
 */
export function createDailyLogRepository({ db, codec }: { db: Database; codec: SensitiveCodec }) {
  return {
    /** その日の振り返り。まだ何も保存していなければ undefined */
    find(day: string): DailyLog | undefined {
      const row = db.select().from(dailyLogs).where(eq(dailyLogs.day, day)).get();
      if (row === undefined) return undefined;
      return {
        ...row,
        thoughtsMd: codec.decode(row.thoughtsMd),
        learningMd: codec.decode(row.learningMd),
      };
    },

    /**
     * 振り返りの本文を保存する。同じ日は上書きする。
     * 朝の計画の確定時刻は振り返りとは別に記録するので、ここでは変えない
     */
    saveReflection(input: {
      day: string;
      thoughtsMd: string;
      learningMd: string;
      at: string;
    }): DailyLog {
      const values = {
        thoughtsMd: codec.encode(input.thoughtsMd),
        learningMd: codec.encode(input.learningMd),
        updatedAt: input.at,
      };
      const row = db
        .insert(dailyLogs)
        .values({ day: input.day, ...values })
        .onConflictDoUpdate({ target: dailyLogs.day, set: values })
        .returning()
        .get();
      return {
        ...row,
        thoughtsMd: input.thoughtsMd,
        learningMd: input.learningMd,
      };
    },

    /**
     * 朝の計画を確定した時刻を残す（FR-D05）。振り返りの本文と更新時刻は変えない
     * （更新時刻は振り返りの下書きの復元の判定に使うため）
     */
    confirmPlan(day: string, at: string): void {
      db.insert(dailyLogs)
        .values({ day, planConfirmedAt: at, updatedAt: at })
        .onConflictDoUpdate({ target: dailyLogs.day, set: { planConfirmedAt: at } })
        .run();
    },
  };
}

export type DailyLogRepository = ReturnType<typeof createDailyLogRepository>;
