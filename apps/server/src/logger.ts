/**
 * サーバーのロガー（ADR-0009、architecture.md 12.6）。1行1件の JSON で出す。
 * 機微データの項目は、入れ子の中まで自動で伏せ字にする。エージェントの入出力の全文は、
 * このロガーではなく agentLog（ローカルにだけ保存し 30 日で消す）に残す。
 */

/** 伏せ字にする項目の名前（DB の列名と、コードの中の名前の両方） */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'thoughts_md',
  'thoughtsMd',
  'learning_md',
  'learningMd',
  'note_md',
  'noteMd',
  'content_json',
  'contentJson',
  'content',
  'reason',
  'aiReason',
  'ai_reason',
  'input',
  'output',
]);

export const REDACTED = '[伏せ字]';

/** 値の中の機微データの項目を伏せ字にした写しを返す（元の値は変えない） */
export function redact(value: unknown, keys: ReadonlySet<string> = SENSITIVE_KEYS): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, keys));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, keys.has(k) ? REDACTED : redact(v, keys)]),
    );
  }
  return value;
}

export type Level = 'info' | 'warn' | 'error';

export type Logger = Record<Level, (message: string, fields?: Record<string, unknown>) => void>;

export function createLogger(
  options: { write?: (line: string) => void; now?: () => Date } = {},
): Logger {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const log =
    (level: Level) =>
    (message: string, fields: Record<string, unknown> = {}) => {
      write(
        JSON.stringify({
          at: now().toISOString(),
          level,
          message,
          ...(redact(fields) as Record<string, unknown>),
        }),
      );
    };
  return { info: log('info'), warn: log('warn'), error: log('error') };
}
