import type { Job } from '@mymind/db';

/** サーバーから画面へ知らせる出来事（ADR-0008）。GET /api/events の SSE で、種類ごとに配信する */
export type ServerEvent = { type: 'job.updated'; job: Job };

/** 通し番号を付けた出来事。番号は SSE の id になり、再接続のときの Last-Event-ID に使われる */
export type NumberedEvent = { id: number; event: ServerEvent };

export type EventBus = {
  publish(event: ServerEvent): void;
  /** 購読を始める。戻り値の関数で購読をやめる */
  subscribe(listener: (event: NumberedEvent) => void): () => void;
  /** 指定した番号より後の、保持している出来事（再接続のあいだの取りこぼしを補う） */
  since(lastId: number): NumberedEvent[];
};

/** 再接続で補うために保持する出来事の数。ジョブの進み具合は数が少ないので、この程度で足りる */
const KEEP = 200;

export function createEventBus(): EventBus {
  const listeners = new Set<(event: NumberedEvent) => void>();
  const recent: NumberedEvent[] = [];
  let seq = 0;
  return {
    publish(event) {
      const numbered = { id: ++seq, event };
      recent.push(numbered);
      if (recent.length > KEEP) recent.shift();
      for (const listener of listeners) listener(numbered);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    since(lastId) {
      return recent.filter((e) => e.id > lastId);
    },
  };
}
