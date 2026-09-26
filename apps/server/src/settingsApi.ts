import type { SettingsRepository } from '@mymind/db';
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { z } from 'zod';

/** 画面から変えられる設定（architecture.md 6章の GET / PATCH /api/settings）。項目を足すときはここに加える */
const appSettingsSchema = z.object({
  /** 依頼の前に毎回、送信内容のプレビューを経由する（FR-A12） */
  confirmBeforeRequest: z.boolean(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = { confirmBeforeRequest: false };

const patchBody = appSettingsSchema
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: '変更する項目を指定してください' });

const fields = appSettingsSchema.shape;

/** 保存されている値（JSON の文字列）を読む。読めない値や形の違う値は、初期値に戻して扱う */
function readSettings(stored: Record<string, string>): AppSettings {
  const read = <K extends keyof AppSettings>(key: K): AppSettings[K] => {
    const raw = stored[key];
    if (raw === undefined) return DEFAULT_SETTINGS[key];
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      // 手で書き換えられたなどで JSON として読めない値は、保存されていないのと同じに扱う
      return DEFAULT_SETTINGS[key];
    }
    const parsed = fields[key].safeParse(value);
    return parsed.success ? (parsed.data as AppSettings[K]) : DEFAULT_SETTINGS[key];
  };
  return { confirmBeforeRequest: read('confirmBeforeRequest') };
}

/** 設定の API。値は settings テーブルに JSON の文字列で保存する */
export function createSettingsApi(settings: SettingsRepository) {
  return new Hono()
    .get('/settings', (c) => c.json({ settings: readSettings(settings.getAll()) }, 200))
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
        return c.json({ settings: readSettings(settings.getAll()) }, 200);
      },
    );
}
