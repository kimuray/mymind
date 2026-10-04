import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';

/** 画面のバナーに出す通知（FR-N05。macOS の通知もブラウザの通知も使えなかったもの） */
const fetchPending = async () => unwrap(await api.notifications.pending.$get());

export type PendingNotification = Awaited<ReturnType<typeof fetchPending>>['notifications'][number];

export const notificationsKey = ['notifications'] as const;

export function usePendingNotifications() {
  return useQuery({ queryKey: notificationsKey, queryFn: fetchPending });
}

/** バナーを閉じる。閉じたものは、次に画面を開いても出さない */
export function useDismissNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: PendingNotification['kind']) =>
      unwrap(await api.notifications.pending[':kind'].$delete({ param: { kind } })),
    onSuccess: (data) => qc.setQueryData(notificationsKey, data),
  });
}

/** ブラウザの通知の許可の状態。通知の API がないブラウザは unsupported */
export type BrowserPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export const browserPermission = (): BrowserPermission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

/** 今の許可の状態をサーバーに知らせる（サーバーが、ブラウザの通知で出せるかを決めるため） */
export async function reportBrowserPermission(): Promise<void> {
  await api.notifications.browser.$put({ json: { permission: browserPermission() } });
}
