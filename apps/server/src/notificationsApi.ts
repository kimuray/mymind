import { NOTIFICATION_KINDS } from '@mymind/domain';
import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { z } from 'zod';
import {
  BROWSER_PERMISSIONS,
  type BrowserPermissionState,
  type PendingNotifications,
} from './notificationAdapters';

export type NotificationsApiDeps = {
  pending: PendingNotifications;
  permission: BrowserPermissionState;
};

const kindParam = z.enum(NOTIFICATION_KINDS);
const permissionBody = z.strictObject({ permission: z.enum(BROWSER_PERMISSIONS) });

const invalid = (issues: z.core.$ZodIssue[]) => ({
  error: {
    code: 'INVALID_REQUEST' as const,
    message: '入力が正しくありません',
    issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  },
});

/**
 * 通知の API（FR-N05、architecture.md 9.2）。
 * 画面のバナーに出す通知の一覧と閉じる操作、画面が知らせるブラウザの通知の許可の状態
 */
export function createNotificationsApi(deps: NotificationsApiDeps) {
  return new Hono()
    .get('/notifications/pending', (c) => c.json({ notifications: deps.pending.list() }, 200))
    .delete('/notifications/pending/:kind', (c) => {
      const kind = kindParam.safeParse(c.req.param('kind'));
      if (!kind.success) return c.json(invalid(kind.error.issues), 400);
      deps.pending.dismiss(kind.data);
      return c.json({ notifications: deps.pending.list() }, 200);
    })
    .put(
      '/notifications/browser',
      validator('json', (value, c) => {
        const parsed = permissionBody.safeParse(value);
        return parsed.success ? parsed.data : c.json(invalid(parsed.error.issues), 400);
      }),
      (c) => {
        deps.permission.report(c.req.valid('json').permission);
        return c.json({ permission: deps.permission.get() }, 200);
      },
    );
}
