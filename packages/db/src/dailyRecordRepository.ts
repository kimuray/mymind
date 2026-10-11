import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { type DAILY_RECORD_SOURCES, dailyRecords } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

export type DailyRecordSource = (typeof DAILY_RECORD_SOURCES)[number];

export type DailyRecordRow = {
  day: string;
  /** 記録の中身。形は使う側（サーバー）がスキーマで検証する。JSON として読めなければ null */
  record: unknown;
  generatedAt: string;
  source: DailyRecordSource;
};

/**
 * 日ごとの記録のスナップショット（architecture.md 4.6、5章の daily_records）。
 * 1日に1件で、保存のたびに上書きする。中身は SensitiveCodec を通す（ADR-0009）
 */
export function createDailyRecordRepository({
  db,
  codec,
}: {
  db: Database;
  codec: SensitiveCodec;
}) {
  return {
    /** その日のスナップショット。まだ取っていなければ undefined */
    find(day: string): DailyRecordRow | undefined {
      const row = db.select().from(dailyRecords).where(eq(dailyRecords.day, day)).get();
      if (row === undefined) return undefined;
      let record: unknown = null;
      try {
        record = JSON.parse(codec.decode(row.recordJson));
      } catch {
        // 壊れた中身は「読めない」として返し、使う側が作り直す（再生成で上書きできる）
        record = null;
      }
      return { day: row.day, record, generatedAt: row.generatedAt, source: row.source };
    },

    /** スナップショットを保存する。同じ日は上書きする */
    save(input: { day: string; record: unknown; source: DailyRecordSource; at: string }): void {
      const values = {
        recordJson: codec.encode(JSON.stringify(input.record)),
        generatedAt: input.at,
        source: input.source,
      };
      db.insert(dailyRecords)
        .values({ day: input.day, ...values })
        .onConflictDoUpdate({ target: dailyRecords.day, set: values })
        .run();
    },
  };
}

export type DailyRecordRepository = ReturnType<typeof createDailyRecordRepository>;
