import { Hono } from 'hono';
import type { Api } from './api';
import { localOnly, type SecurityOptions } from './security';

/**
 * アプリの入口。検証のミドルウェアを最初に置き、以降に追加するルートがすべてその内側に入るようにする（NFR-02）。
 * 画面（web）は API より後に置き、API 以外の GET に index.html を返す。
 */
export function createApp(security: SecurityOptions, api?: Api, web?: Hono | null): Hono {
  const app = new Hono();
  app.use('*', localOnly(security));
  if (api) app.route('/api', api);
  if (web) app.route('/', web);
  return app;
}
