import type { Job } from '@mymind/db';

/** サーバーから画面へ知らせる出来事（ADR-0008）。GET /api/events の SSE で、種類ごとに配信する */
export type ServerEvent = { type: 'job.updated'; job: Job };

export type EventBus = {
  publish(event: ServerEvent): void;
  /** 購読を始める。戻り値の関数で購読をやめる */
  subscribe(listener: (event: ServerEvent) => void): () => void;
};

export function createEventBus(): EventBus {
  const listeners = new Set<(event: ServerEvent) => void>();
  return {
    publish(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
