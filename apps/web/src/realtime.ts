import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * 画面が受け取る変更の知らせ（ADR-0008）。画面のコードは RealtimeChannel だけを使い、
 * BroadcastChannel や SSE の詳細を知らない。
 */
export type RealtimeMessage =
  /** タスク・計画・履歴が変わった（別のタブでの操作） */
  | { type: 'tasks.changed' }
  /** エージェントのジョブの状態が変わった（サーバーから） */
  | { type: 'job.updated'; jobId: string; status: string };

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
      source.addEventListener('job.updated', onJob);
      return () => source.removeEventListener('job.updated', onJob);
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

function invalidateFor(qc: QueryClient, message: RealtimeMessage) {
  if (message.type === 'tasks.changed') {
    qc.invalidateQueries({ queryKey: ['day'] });
    qc.invalidateQueries({ queryKey: ['backlog'] });
    qc.invalidateQueries({ queryKey: ['events'] });
  } else {
    qc.invalidateQueries({ queryKey: ['jobs', message.jobId] });
    qc.invalidateQueries({ queryKey: ['feedbacks'] });
  }
}

/** 他のタブとサーバーからの知らせを受け取り、該当するクエリを読み直させる（NFR-13） */
export function useRealtimeSync() {
  const qc = useQueryClient();
  useEffect(() => {
    const server = createServerChannel();
    const offTabs = tabChannel().subscribe((m) => invalidateFor(qc, m));
    const offServer = server.subscribe((m) => invalidateFor(qc, m));
    return () => {
      offTabs();
      offServer();
      server.close();
    };
  }, [qc]);
}
