import { isAbsolute } from 'node:path';
import type { SettingsRepository } from '@mymind/db';
import {
  DEFAULT_NOTIFICATION_SCHEDULES,
  DEFAULT_REVIEW_AFTER_DAYS,
  type NotificationKind,
  SCHEDULE_TIME_PATTERN,
  type ScheduleSpec,
} from '@mymind/domain';
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { z } from 'zod';
import { agentChoiceSchema } from './agents';
import { DEFAULT_BACKUP_GENERATIONS } from './backups';

const timeSchema = z
  .string()
  .regex(SCHEDULE_TIME_PATTERN, '時刻は HH:MM（00:00〜23:59）で指定してください');

/** 毎日の通知の設定（FR-N04）。オン・オフと時刻 */
const dailyNotificationSchema = z.strictObject({ enabled: z.boolean(), time: timeSchema });

/** 毎週の通知の設定（FR-N04）。曜日は 0=日曜 〜 6=土曜 */
const weeklyNotificationSchema = z.strictObject({
  enabled: z.boolean(),
  time: timeSchema,
  weekday: z.number().int().min(0).max(6),
});

/** 画面から変えられる設定（architecture.md 6章の GET / PATCH /api/settings）。項目を足すときはここに加える */
const appSettingsSchema = z.object({
  /** 依頼の前に毎回、送信内容のプレビューを経由する（FR-A12） */
  confirmBeforeRequest: z.boolean(),
  /** FB を依頼するときに、はじめに選ばれているエージェント（FR-A07） */
  defaultAgent: agentChoiceSchema,
  /**
   * 最後に触れてから何日経ったバックログのタスクを、棚卸しの対象にするか（FR-R06）。
   * 0 ならバックログのすべてが対象になる（溜まったバックログをまとめて見直すときや、画面の確認に使う）
   */
  reviewAfterDays: z.number().int().min(0).max(365),
  /** 毎日のバックアップの保存先（NFR-04）。null ならデータディレクトリの backups/。データディレクトリの外も選べる */
  backupDir: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .refine(isAbsolute, { message: '保存先は / から始まる絶対パスで指定してください' })
    .nullable(),
  /** 毎日のバックアップを残す世代数（NFR-04） */
  backupGenerations: z.number().int().min(1).max(365),
  /** 朝の通知（FR-N01、FR-N04） */
  morningNotification: dailyNotificationSchema,
  /** 夜の通知（FR-N02、FR-N04） */
  eveningNotification: dailyNotificationSchema,
  /** 棚卸しの通知（FR-N03、FR-N04） */
  inventoryNotification: weeklyNotificationSchema,
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

/** 保存されていない項目の値。既定のエージェントは起動の設定（MYMIND_AGENT）で変わるので、作るときに上書きする */
export const DEFAULT_SETTINGS: AppSettings = {
  confirmBeforeRequest: false,
  defaultAgent: 'claude',
  reviewAfterDays: DEFAULT_REVIEW_AFTER_DAYS,
  backupDir: null,
  backupGenerations: DEFAULT_BACKUP_GENERATIONS,
  morningNotification: { enabled: true, ...DEFAULT_NOTIFICATION_SCHEDULES.morning },
  eveningNotification: { enabled: true, ...DEFAULT_NOTIFICATION_SCHEDULES.evening },
  inventoryNotification: {
    enabled: true,
    time: DEFAULT_NOTIFICATION_SCHEDULES.inventory.time,
    weekday: DEFAULT_NOTIFICATION_SCHEDULES.inventory.weekday ?? 0,
  },
};

/** 通知の種類ごとの設定の項目 */
const NOTIFICATION_SETTING_KEYS = {
  morning: 'morningNotification',
  evening: 'eveningNotification',
  inventory: 'inventoryNotification',
} as const satisfies Record<NotificationKind, keyof AppSettings>;

/** 設定から、その種類の通知の予定を決める。オフなら null（送らない、FR-N04） */
export function notificationScheduleOf(
  settings: AppSettings,
  kind: NotificationKind,
): ScheduleSpec | null {
  const setting = settings[NOTIFICATION_SETTING_KEYS[kind]];
  if (!setting.enabled) return null;
  return 'weekday' in setting
    ? { time: setting.time, weekday: setting.weekday }
    : { time: setting.time };
}

const patchBody = appSettingsSchema
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: '変更する項目を指定してください' });

const fields = appSettingsSchema.shape;

/** 保存されている値（JSON の文字列）を読む。読めない値や形の違う値は、初期値に戻して扱う */
function readSettings(stored: Record<string, string>, defaults: AppSettings): AppSettings {
  const read = <K extends keyof AppSettings>(key: K): AppSettings[K] => {
    const raw = stored[key];
    if (raw === undefined) return defaults[key];
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      // 手で書き換えられたなどで JSON として読めない値は、保存されていないのと同じに扱う
      return defaults[key];
    }
    const parsed = fields[key].safeParse(value);
    return parsed.success ? (parsed.data as AppSettings[K]) : defaults[key];
  };
  return {
    confirmBeforeRequest: read('confirmBeforeRequest'),
    defaultAgent: read('defaultAgent'),
    reviewAfterDays: read('reviewAfterDays'),
    backupDir: read('backupDir'),
    backupGenerations: read('backupGenerations'),
    morningNotification: read('morningNotification'),
    eveningNotification: read('eveningNotification'),
    inventoryNotification: read('inventoryNotification'),
  };
}

/** 今の設定を読む関数を作る。FB の依頼など、API の外からも同じ読み方で設定を使う */
export function createSettingsReader(
  settings: SettingsRepository,
  defaults: Partial<AppSettings> = {},
): () => AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...defaults };
  return () => readSettings(settings.getAll(), merged);
}

/** 設定の API。値は settings テーブルに JSON の文字列で保存する */
/** 起動の設定で決まり、画面からは変えられない値（設定の画面と依頼の画面で、選択が使われるかを伝えるため） */
export type SettingsRuntime = {
  /** MYMIND_AGENT=fake で動いている。エージェントの選択に関係なく偽のアダプタを使う（FR-A07） */
  fakeAgent: boolean;
  /** 保存先を指定しないときの、毎日のバックアップの置き場所（設定の画面に出す） */
  defaultBackupDir: string;
};

export function createSettingsApi(
  settings: SettingsRepository,
  defaults: Partial<AppSettings> = {},
  runtime: SettingsRuntime = { fakeAgent: false, defaultBackupDir: '' },
  /** 保存したあとに呼ぶ（通知の時刻が変わったら、スケジューラの予定を組み直すため、FR-N04） */
  onChange: () => void = () => {},
) {
  const current = createSettingsReader(settings, defaults);
  return new Hono()
    .get('/settings', (c) => c.json({ settings: current(), runtime }, 200))
    .patch(
      '/settings',
      validator('json', (value, c) => {
        const parsed = patchBody.safeParse(value);
        if (parsed.success) return parsed.data;
        return c.json(
          {
            error: {
              code: 'INVALID_REQUEST' as const,
              message: '入力が正しくありません',
              issues: parsed.error.issues.map((i) => ({
                path: i.path.join('.'),
                message: i.message,
              })),
            },
          },
          400,
        );
      }),
      (c) => {
        const patch = c.req.valid('json');
        settings.setMany(
          Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, JSON.stringify(v)])),
        );
        onChange();
        return c.json({ settings: current(), runtime }, 200);
      },
    );
}
