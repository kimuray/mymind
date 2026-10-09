import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * 画面が受け取る変更の知らせ（ADR-0008）。画面のコードは RealtimeChannel だけを使い、
 * BroadcastChannel や SSE の詳細を知らない。
 */
export type RealtimeMessage =
  /** タスク・計画・履歴が変わった（別のタブでの操作） */
  | { type: 'tasks.changed' }
  /** 振り返りが変わった（別のタブでの操作。カレンダーの記録の有無が変わる） */
  | { type: 'records.changed' }
  /** 設定が変わった（別のタブでの操作。既定のエージェントなど、依頼に使う値が変わる） */
  | { type: 'settings.changed' }
  /** エージェントのジョブの状態が変わった（サーバーから） */
  | { type: 'job.updated'; jobId: string; status: string }
  /** ブラウザの通知を出してほしい（サーバーから、FR-N05） */
  | { type: 'notification.show'; notification: ShownNotification }
  /** 画面のバナーに出す通知が変わった（サーバーから、FR-N05） */
  | { type: 'notifications.changed' };

/** ブラウザの通知に出す中身。path はクリックしたときに開く画面 */
export type ShownNotification = { kind: string; title: string; body: string; path: string };

export type RealtimeChannel = {
  publish(message: RealtimeMessage): void;
  subscribe(listener: (message: RealtimeMessage) => void): () => void;
  close(): void;
};

/** 同じブラウザのタブ間（サーバーを介さない）。自分が送った知らせは自分には届かない */
export function createBroadcastChannel(name = 'mymind'): RealtimeChannel {
  const channel = new BroadcastChannel(name);
  return {
    publish: (message) => channel.postMessage(message),
    subscribe(listener) {
      const onMessage = (e: MessageEvent<RealtimeMessage>) => listener(e.data);
      channel.addEventListener('message', onMessage);
      return () => channel.removeEventListener('message', onMessage);
    },
    close: () => channel.close(),
  };
}

/**
 * サーバーから（GET /api/events の SSE）。受け取るだけで、publish は何もしない。
 * EventSource は切れても自動で再接続し、Last-Event-ID で取りこぼしを補ってもらう。
 */
export function createServerChannel(url = '/api/events'): RealtimeChannel {
  const source = new EventSource(url);
  return {
    publish: () => {},
    subscribe(listener) {
      const onJob = (e: MessageEvent<string>) => {
        const data = JSON.parse(e.data) as { job: { id: string; status: string } };
        listener({ type: 'job.updated', jobId: data.job.id, status: data.job.status });
      };
      const onShow = (e: MessageEvent<string>) => {
        const data = JSON.parse(e.data) as { notification: ShownNotification };
        listener({ type: 'notification.show', notification: data.notification });
      };
      const onChanged = () => listener({ type: 'notifications.changed' });
      source.addEventListener('job.updated', onJob);
      source.addEventListener('notification.show', onShow);
      source.addEventListener('notifications.changed', onChanged);
      return () => {
        source.removeEventListener('job.updated', onJob);
        source.removeEventListener('notification.show', onShow);
        source.removeEventListener('notifications.changed', onChanged);
      };
    },
    close: () => source.close(),
  };
}

// タブの中で1つだけ持つ（変更の成功を他のタブへ知らせるため、どこからでも publish できるようにする）
let tabs: RealtimeChannel | null = null;
const tabChannel = () => {
  tabs ??= createBroadcastChannel();
  return tabs;
};

/** このタブでの変更が成功したことを、他のタブに知らせる（architecture.md 12.3） */
export function notifyTasksChanged() {
  if (typeof BroadcastChannel === 'undefined') return;
  tabChannel().publish({ type: 'tasks.changed' });
}

/** このタブで設定を変えたことを、他のタブに知らせる（FR-A07 の既定のエージェントを古いまま使わせないため） */
export function notifySettingsChanged() {
  if (typeof BroadcastChannel === 'undefined') return;
  tabChannel().publish({ type: 'settings.changed' });
}

/** このタブで振り返りを保存したことを、他のタブに知らせる（NFR-13、FR-R04） */
export function notifyRecordsChanged() {
  if (typeof BroadcastChannel === 'undefined') return;
  tabChannel().publish({ type: 'records.changed' });
}

function invalidateFor(qc: QueryClient, message: RealtimeMessage) {
  if (message.type === 'records.changed') {
    qc.invalidateQueries({ queryKey: ['day'] });
    qc.invalidateQueries({ queryKey: ['month'] });
  } else if (message.type === 'settings.changed') {
    qc.invalidateQueries({ queryKey: ['settings'] });
    // 棚卸しの日数（FR-R06）で対象が変わる
    qc.invalidateQueries({ queryKey: ['review'] });
  } else if (message.type === 'tasks.changed') {
    // タグの一覧（付いているタスクの数、名前、色。FR-T13）も、別のタブでの付け外しや変更で変わる
    qc.invalidateQueries({ queryKey: ['tags'] });
    qc.invalidateQueries({ queryKey: ['day'] });
    qc.invalidateQueries({ queryKey: ['backlog'] });
    qc.invalidateQueries({ queryKey: ['carryover'] });
    qc.invalidateQueries({ queryKey: ['events'] });
    // 棚卸しの対象（FR-R06）
    qc.invalidateQueries({ queryKey: ['review'] });
    // タイムラインの区間（FR-R01）
    qc.invalidateQueries({ queryKey: ['timeline'] });
    // カレンダーの完了件数（FR-R04）
    qc.invalidateQueries({ queryKey: ['month'] });
  } else if (message.type === 'notifications.changed') {
    qc.invalidateQueries({ queryKey: ['notifications'] });
  } else if (message.type === 'job.updated') {
    qc.invalidateQueries({ queryKey: ['jobs', message.jobId] });
    qc.invalidateQueries({ queryKey: ['feedbacks'] });
    // その日の応答に、最新のジョブと FB と調子が入っている（GET /api/days/:day）
    qc.invalidateQueries({ queryKey: ['day'] });
    // カレンダーの調子と FB の有無（FR-R04）、タイムラインの調子のレーン（FR-R02）
    qc.invalidateQueries({ queryKey: ['month'] });
    qc.invalidateQueries({ queryKey: ['timeline'] });
  }
}

/**
 * ブラウザの通知を出す（FR-N05）。クリックしたら、このタブを前に出して、その種類の画面を開く。
 * 同じ種類の通知は tag で置き換えるので、タブを複数開いていても1つしか残らない
 */
export function showBrowserNotification(n: ShownNotification, open: (path: string) => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const notice = new Notification(n.title, { body: n.body, tag: `mymind-${n.kind}` });
  notice.onclick = () => {
    window.focus();
    open(n.path);
    notice.close();
  };
}

/**
 * 他のタブとサーバーからの知らせを受け取り、該当するクエリを読み直させる（NFR-13）。
 * サーバーから通知を頼まれたら、ブラウザの通知を出す（FR-N05）
 */
export function useRealtimeSync(open: (path: string) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    const server = createServerChannel();
    const offTabs = tabChannel().subscribe((m) => invalidateFor(qc, m));
    const offServer = server.subscribe((m) =>
      m.type === 'notification.show'
        ? showBrowserNotification(m.notification, open)
        : invalidateFor(qc, m),
    );
    return () => {
      offTabs();
      offServer();
      server.close();
    };
  }, [qc, open]);
}
