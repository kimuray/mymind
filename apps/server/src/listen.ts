import { serve } from '@hono/node-server';
import type { Hono } from 'hono';

export type ListenError = { kind: 'port_in_use'; port: number };

export type RunningServer = { close: () => Promise<void> };

/**
 * 指定のポートで待ち受ける。使用中でも別のポートは探さない（ADR-0007）。
 * ポートが変わると Host・Origin の許可リストと、ブラウザで開く URL がずれるため。
 */
export function listen(
  app: Hono,
  host: string,
  port: number,
): Promise<{ ok: true; value: RunningServer } | { ok: false; error: ListenError }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = serve({ fetch: app.fetch, hostname: host, port }, () => {
      server.off('error', onError);
      resolvePromise({
        ok: true,
        value: {
          close: () =>
            new Promise((done, fail) => server.close((err) => (err ? fail(err) : done()))),
        },
      });
    });
    function onError(err: NodeJS.ErrnoException) {
      if (err.code === 'EADDRINUSE') {
        resolvePromise({ ok: false, error: { kind: 'port_in_use', port } });
      } else {
        rejectPromise(err);
      }
    }
    server.once('error', onError);
  });
}
