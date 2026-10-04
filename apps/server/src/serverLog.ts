import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { toBusinessDay } from '@mymind/domain';

/** サーバーのログを残す日数（NFR-24） */
export const SERVER_LOG_RETENTION_DAYS = 14;

const LOG_FILE = /^(\d{4}-\d{2}-\d{2})\.log$/;

export type ServerLogFileOptions = {
  /** 書き出す場所（データディレクトリの logs/server） */
  dir: string;
  now?: () => Date;
  /** ファイル名の日付を数えるタイムゾーン（業務日と同じ）。日付は 0 時で切り替える */
  timeZone: string;
  /** 書けなかったとき（ディスクの空きがないなど）。サーバーは止めずに知らせる */
  onError?: (error: unknown) => void;
};

/**
 * サーバーのログを、日付ごとのファイル（logs/server/<日付>.log）に1行ずつ追記する（NFR-24）。
 * 機微データの伏せ字はロガーが済ませた行を受け取る。ディレクトリは 700、ファイルは 600（ADR-0009）。
 * 14日を過ぎたファイルは、最初に書くときと日付が変わったときに消す
 */
export function createServerLogFile(options: ServerLogFileOptions) {
  const now = options.now ?? (() => new Date());
  const onError =
    options.onError ??
    ((e: unknown) =>
      process.stderr.write(
        `ログをファイルに書けませんでした: ${e instanceof Error ? e.message : String(e)}\n`,
      ));
  let currentDate: string | null = null;

  const dateOf = (at: Date) => toBusinessDay(at, { timeZone: options.timeZone, dayStartHour: 0 });

  /** today から数えて残す日数を過ぎたファイルを消す。消したファイル名を返す */
  const prune = (today: string): string[] => {
    if (!existsSync(options.dir)) return [];
    const [y, m, d] = today.split('-').map(Number);
    const cutoff = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) - SERVER_LOG_RETENTION_DAYS))
      .toISOString()
      .slice(0, 10);
    const removed = readdirSync(options.dir).filter((name) => {
      const date = name.match(LOG_FILE)?.[1];
      return date !== undefined && date < cutoff;
    });
    for (const name of removed) rmSync(join(options.dir, name), { force: true });
    return removed;
  };

  return {
    write(line: string): void {
      try {
        const date = dateOf(now());
        if (date !== currentDate) {
          mkdirSync(options.dir, { recursive: true, mode: 0o700 });
          chmodSync(options.dir, 0o700);
          prune(date);
          currentDate = date;
        }
        const path = join(options.dir, `${date}.log`);
        const isNew = !existsSync(path);
        appendFileSync(path, `${line}\n`, { mode: 0o600 });
        // umask で作られた権限に関係なく、本人だけが読めるようにする
        if (isNew) chmodSync(path, 0o600);
      } catch (e) {
        onError(e);
      }
    },
    prune,
  };
}

export type ServerLogFile = ReturnType<typeof createServerLogFile>;
