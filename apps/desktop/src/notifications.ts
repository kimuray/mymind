import type { DesktopReply } from '@mymind/server/desktop-bridge';

/** サーバーから頼まれた通知（desktopMessageSchema で検証済みのもの） */
export type NotifyRequest = {
  id: number;
  notification: { kind: string; title: string; body: string; path: string };
};

/**
 * 通知のクリックで移ってよい画面のパスか。アプリの中のパス（/ から始まり、// ではない）だけを許す。
 * `//example.com` のようなパスは、別のオリジンへの URL として読まれるため
 */
export const isAppPath = (path: string): boolean =>
  path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');

/**
 * サーバーから頼まれた通知を、OS の通知で出す（FR-N05、ADR-0015）。クリックされたらその画面へ移る。
 * 出せないとき（通知を使えない環境、パスが正しくない）は、サーバーが次の手段（画面のバナー）に回せるよう失敗を返す
 */
export function handleNotifyRequest(
  request: NotifyRequest,
  deps: {
    isSupported: () => boolean;
    show: (notification: { title: string; body: string }, onClick: () => void) => void;
    openPath: (path: string) => void;
  },
): DesktopReply {
  const { id, notification } = request;
  if (!isAppPath(notification.path)) {
    return { type: 'notify-result', id, ok: false, message: '開く画面のパスが正しくありません' };
  }
  if (!deps.isSupported()) {
    return { type: 'notify-result', id, ok: false, message: 'この環境では OS の通知を使えません' };
  }
  deps.show({ title: notification.title, body: notification.body }, () =>
    deps.openPath(notification.path),
  );
  return { type: 'notify-result', id, ok: true };
}
