import { useRouter } from '@tanstack/react-router';
import { useDismissNotification, usePendingNotifications } from '../api/notifications';
import { Button } from './Button';

/**
 * 通知のバナー（FR-N05、DESIGN.md 4.17）。macOS の通知もブラウザの通知も使えなかった通知を、
 * 次に画面を開いたとき（開いている画面にはすぐ）に右下へ出す。閉じるまで残る
 */
export function NotificationBanner() {
  const pending = usePendingNotifications();
  const dismiss = useDismissNotification();
  const router = useRouter();
  const notifications = pending.data?.notifications ?? [];
  return (
    <section className="notification-banners" aria-label="通知" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.kind} className="notification-banner neu-raised-3" role="status">
          <h2 className="notification-banner-title">{n.title}</h2>
          <p>{n.body}</p>
          <div className="dialog-actions">
            <Button
              kind="primary"
              onClick={() => {
                dismiss.mutate(n.kind);
                router.history.push(n.path);
              }}
            >
              開く
            </Button>
            <Button onClick={() => dismiss.mutate(n.kind)}>閉じる</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
