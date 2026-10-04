import type { Notification } from '@mymind/domain';
import { describe, expect, it } from 'vitest';
import { createEventBus, type ServerEvent } from './events';
import { createLogger } from './logger';
import {
  activeChannel,
  createBannerChannel,
  createBrowserChannel,
  createBrowserPermissionState,
  createMacosChannel,
  createNotificationRouter,
  createPendingNotifications,
  findExecutable,
  type NotificationChannel,
  notifierArgs,
  runCommand,
} from './notificationAdapters';
import { createNotificationsApi } from './notificationsApi';

const BASE = 'http://127.0.0.1:4820';
const morning: Notification = {
  kind: 'morning',
  title: '朝の計画',
  body: '持ち越しが2件あります',
  path: '/morning',
};
const NOW = new Date('2026-10-05T00:00:00.000Z');

describe('FR-N05 通知をクリックしたときに開く画面', () => {
  it.each([
    ['morning', '/morning'],
    ['evening', '/reflection'],
    ['inventory', '/backlog'],
  ] as const)('%s の通知は %s を開く', (kind, path) => {
    const args = notifierArgs({ kind, title: 't', body: 'b', path }, BASE);
    expect(args[args.indexOf('-open') + 1]).toBe(`${BASE}${path}`);
  });

  it('通知のコマンドには、題名・本文・開く URL・種類ごとのグループを引数の配列で渡す', () => {
    expect(notifierArgs(morning, BASE)).toEqual([
      '-title',
      'mymind',
      '-subtitle',
      '朝の計画',
      '-message',
      '持ち越しが2件あります',
      '-open',
      'http://127.0.0.1:4820/morning',
      '-group',
      'mymind-morning',
    ]);
  });
});

describe('FR-N05 通知のコマンドを探す', () => {
  it('PATH の順に探し、最初に実行できるものを返す', () => {
    const found = findExecutable('terminal-notifier', '/usr/bin:/custom/bin', (p) =>
      p.startsWith('/custom/bin'),
    );
    expect(found).toBe('/custom/bin/terminal-notifier');
  });

  it('PATH になくても、Homebrew の場所にあれば見つける（launchd から起動したとき）', () => {
    expect(
      findExecutable('terminal-notifier', '/usr/bin', (p) => p.startsWith('/opt/homebrew/bin')),
    ).toBe('/opt/homebrew/bin/terminal-notifier');
  });

  it('どこにもなければ null', () => {
    expect(findExecutable('terminal-notifier', undefined, () => false)).toBeNull();
  });
});

describe('FR-N05 通知のコマンドを動かす', () => {
  it('終了コード 0 なら成功', async () => {
    expect(await runCommand('true', [])).toEqual({ ok: true });
  });

  it('失敗したら終了コードを返し、引数（通知文）は理由に入れない', async () => {
    const result = await runCommand('false', ['-message', '持ち越しが2件あります']);
    expect(result).toEqual({ ok: false, message: 'false が失敗しました（終了コード 1）' });
  });

  it('コマンドがなければ、見つからないことを返す', async () => {
    expect(await runCommand('mymind-no-such-command', [])).toEqual({
      ok: false,
      message: 'mymind-no-such-command が失敗しました（見つかりません）',
    });
  });
});

/** 手段を作る。macOS のコマンドの有無とブラウザの許可を変えられる */
function setup(options: { command: string | null; granted: boolean; tabs: number }) {
  const events = createEventBus();
  const published: ServerEvent[] = [];
  events.subscribe((e) => published.push(e.event));
  // 記録用の購読を除いた数を、開いているタブの数にする
  for (let i = 1; i < options.tabs; i++) events.subscribe(() => {});
  const permission = createBrowserPermissionState();
  if (options.granted) permission.report('granted');
  const runs: { file: string; args: readonly string[] }[] = [];
  const pending = createPendingNotifications(() => NOW);
  const macos = createMacosChannel({
    command: () => options.command,
    baseUrl: BASE,
    run: async (file, args) => {
      runs.push({ file, args });
      return { ok: true };
    },
  });
  const channels = [
    macos,
    createBrowserChannel({
      events: options.tabs === 0 ? { ...events, subscriberCount: () => 0 } : events,
      permission,
    }),
    createBannerChannel({ pending, events }),
  ];
  const lines: string[] = [];
  const router = createNotificationRouter(channels, createLogger({ write: (l) => lines.push(l) }));
  return { channels, router, runs, published, pending, lines };
}

describe('FR-N05 通知のアダプタの選び方', () => {
  it('通知のコマンドがあれば、macOS の通知で出す', async () => {
    const s = setup({ command: '/opt/homebrew/bin/terminal-notifier', granted: true, tabs: 1 });
    expect(activeChannel(s.channels)).toBe('macos');
    expect(await s.router.notify(morning)).toEqual({ ok: true });
    expect(s.runs).toEqual([
      { file: '/opt/homebrew/bin/terminal-notifier', args: notifierArgs(morning, BASE) },
    ]);
    expect(s.published).toEqual([]);
  });

  it('コマンドがなく、許可されたタブが開いていれば、SSE で画面に知らせてブラウザの通知で出す', async () => {
    const s = setup({ command: null, granted: true, tabs: 1 });
    expect(activeChannel(s.channels)).toBe('browser');
    await s.router.notify(morning);
    expect(s.published).toEqual([{ type: 'notification.show', notification: morning }]);
    expect(s.pending.list()).toEqual([]);
  });

  it('ブラウザの通知が許可されていなければ、画面のバナーにする', async () => {
    const s = setup({ command: null, granted: false, tabs: 1 });
    expect(activeChannel(s.channels)).toBe('banner');
    await s.router.notify(morning);
    expect(s.pending.list()).toEqual([{ ...morning, at: NOW.toISOString() }]);
    expect(s.published).toEqual([{ type: 'notifications.changed' }]);
  });

  it('許可されていても、開いているタブがなければ画面のバナーにする', async () => {
    const s = setup({ command: null, granted: true, tabs: 0 });
    expect(activeChannel(s.channels)).toBe('banner');
  });

  it('コマンドが失敗したら、次の手段で出し、ログに通知文を残さない', async () => {
    const s = setup({ command: '/usr/local/bin/terminal-notifier', granted: false, tabs: 1 });
    const failing: NotificationChannel = {
      name: 'macos',
      isAvailable: () => true,
      notify: async () => ({
        ok: false,
        message: 'terminal-notifier が失敗しました（終了コード 1）',
      }),
    };
    const router = createNotificationRouter(
      [failing, ...s.channels.slice(1)],
      createLogger({ write: (l) => s.lines.push(l) }),
    );
    expect(await router.notify(morning)).toEqual({ ok: true });
    expect(s.pending.list()).toHaveLength(1);
    expect(s.lines.join('\n')).toContain('次の手段で出します');
    expect(s.lines.join('\n')).not.toContain('持ち越し');
  });
});

describe('FR-N05 画面のバナーとブラウザの通知の API', () => {
  const api = () => {
    const pending = createPendingNotifications(() => NOW);
    const permission = createBrowserPermissionState();
    return { app: createNotificationsApi({ pending, permission }), pending, permission };
  };
  const json = (body: unknown) => ({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('バナーに出す通知を返し、閉じると一覧から消える', async () => {
    const { app, pending } = api();
    pending.add(morning);
    const listed = await (await app.request('/notifications/pending')).json();
    expect(listed).toEqual({ notifications: [{ ...morning, at: NOW.toISOString() }] });
    const res = await app.request('/notifications/pending/morning', { method: 'DELETE' });
    expect(await res.json()).toEqual({ notifications: [] });
  });

  it('知らない種類は 400', async () => {
    const { app } = api();
    expect((await app.request('/notifications/pending/noon', { method: 'DELETE' })).status).toBe(
      400,
    );
  });

  it('画面が知らせたブラウザの通知の許可を覚え、知らない値は 400 にする', async () => {
    const { app, permission } = api();
    const res = await app.request('/notifications/browser', {
      method: 'PUT',
      ...json({ permission: 'granted' }),
    });
    expect(res.status).toBe(200);
    expect(permission.get()).toBe('granted');
    const bad = await app.request('/notifications/browser', {
      method: 'PUT',
      ...json({ permission: 'yes' }),
    });
    expect(bad.status).toBe(400);
    expect(permission.get()).toBe('granted');
  });
});
