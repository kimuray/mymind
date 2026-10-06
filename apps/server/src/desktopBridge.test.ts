import type { Notification } from '@mymind/domain';
import { describe, expect, it } from 'vitest';
import {
  createDesktopNotifier,
  type DesktopMessage,
  desktopMessageSchema,
  desktopParentPort,
  type ParentPort,
} from './desktopBridge';

const morning: Notification = {
  kind: 'morning',
  title: '朝の計画',
  body: '持ち越しが2件あります',
  path: '/morning',
};

/** 偽の通信路。送った知らせを覚え、テストからメインプロセスの返事を送れる */
function fakePort() {
  const sent: DesktopMessage[] = [];
  let listener: (message: unknown) => void = () => {};
  const port: ParentPort = {
    postMessage: (m) => sent.push(m),
    onMessage: (l) => {
      listener = l;
    },
  };
  return { port, sent, reply: (message: unknown) => listener(message) };
}

/** 手で進めるタイマー */
function manualTimers() {
  const timers: { fn: () => void; cancelled: boolean }[] = [];
  return {
    setTimer: (fn: () => void) => {
      const t = { fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    fireAll: () => {
      for (const t of timers) if (!t.cancelled) t.fn();
    },
  };
}

describe('FR-N05 デスクトップアプリに OS の通知を頼む', () => {
  it('通知を id 付きで頼み、同じ id の返事で出せたことを知る', async () => {
    const { port, sent, reply } = fakePort();
    const notifier = createDesktopNotifier(port, manualTimers());
    const result = notifier.notify(morning);
    expect(sent).toEqual([{ type: 'notify', id: 1, notification: morning }]);
    reply({ type: 'notify-result', id: 1, ok: true });
    expect(await result).toEqual({ ok: true });
  });

  it('出せなかったという返事なら、その理由を返す', async () => {
    const { port, reply } = fakePort();
    const notifier = createDesktopNotifier(port, manualTimers());
    const result = notifier.notify(morning);
    reply({
      type: 'notify-result',
      id: 1,
      ok: false,
      message: 'この環境では OS の通知を使えません',
    });
    expect(await result).toEqual({ ok: false, message: 'この環境では OS の通知を使えません' });
  });

  it('同時に頼んでも、返事を id で取り違えない。形の違う返事は無視する', async () => {
    const { port, reply } = fakePort();
    const notifier = createDesktopNotifier(port, manualTimers());
    const first = notifier.notify(morning);
    const second = notifier.notify({ ...morning, kind: 'evening', path: '/reflection' });
    reply({ type: 'notify-result', id: 'x', ok: true });
    reply({ type: 'notify-result', id: 2, ok: false, message: '止められています' });
    reply({ type: 'notify-result', id: 1, ok: true });
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: false, message: '止められています' });
  });

  it('返事が来なければ、出せなかったことにする（次の手段に回すため）', async () => {
    const { port } = fakePort();
    const timers = manualTimers();
    const notifier = createDesktopNotifier(port, timers);
    const result = notifier.notify(morning);
    timers.fireAll();
    expect(await result).toEqual({
      ok: false,
      message: 'デスクトップアプリから返事がありませんでした',
    });
  });

  it('普通の Node.js（デスクトップアプリの外）では、通信路はない', () => {
    expect(desktopParentPort()).toBeNull();
  });

  it('アプリの外へのパスを含む通知の依頼は、形として受け付けない', () => {
    expect(
      desktopMessageSchema.safeParse({
        type: 'notify',
        id: 1,
        notification: { ...morning, path: 'https://example.com' },
      }).success,
    ).toBe(false);
  });
});
