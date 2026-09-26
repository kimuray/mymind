import type { Database } from './client';
import { settings } from './schema';

/**
 * 設定（architecture.md 5章の settings）。値は文字列で保存し、意味と検証は使う側（サーバー）のスキーマが持つ
 */
export function createSettingsRepository({ db }: { db: Database }) {
  return {
    /** 保存されているすべての設定。まだ保存していない項目は含まない */
    getAll(): Record<string, string> {
      const rows = db.select().from(settings).all();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },

    /** 複数の項目をまとめて保存する。途中で失敗したら、どれも保存しない */
    setMany(entries: Record<string, string>): void {
      db.transaction((tx) => {
        for (const [key, value] of Object.entries(entries)) {
          tx.insert(settings)
            .values({ key, value })
            .onConflictDoUpdate({ target: settings.key, set: { value } })
            .run();
        }
      });
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
