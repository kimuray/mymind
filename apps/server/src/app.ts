import { Hono } from 'hono';
import type { Api } from './api';
import { localOnly, type SecurityOptions } from './security';

/**
 * アプリの入口。検証のミドルウェアを最初に置き、以降に追加するルートがすべてその内側に入るようにする（NFR-02）。
 */
export function createApp(security: SecurityOptions, api?: Api): Hono {
  const app = new Hono();
  app.use('*', localOnly(security));
  if (api) app.route('/api', api);
  return app;
}
