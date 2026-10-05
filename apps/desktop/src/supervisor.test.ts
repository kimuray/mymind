import { describe, expect, it } from 'vitest';
import { createSupervisor, type ServerProcess } from './supervisor';

/** 偽のサーバー。テストから知らせを送ったり、終了させたりする */
function fakeServers() {
  const started: {
    exit: (code: number) => void;
    send: (message: unknown) => void;
    killed: boolean;
  }[] = [];
  const start = (): ServerProcess => {
    let onExit: (code: number) => void = () => {};
    let onMessage: (message: unknown) => void = () => {};
    const handle = {
      exit: (code: number) => onExit(code),
      send: (message: unknown) => onMessage(message),
      killed: false,
    };
    started.push(handle);
    return {
      onExit: (listener) => {
        onExit = listener;
      },
      onMessage: (listener) => {
        onMessage = listener;
      },
      kill: () => {
        handle.killed = true;
        onExit(0);
      },
    };
  };
  return { started, start };
}

const parseMessage = (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as { type?: unknown; url?: unknown; reason?: unknown };
  if (m.type === 'ready' && typeof m.url === 'string')
    return { type: 'ready' as const, url: m.url };
  if (m.type === 'fatal' && typeof m.reason === 'string')
    return { type: 'fatal' as const, reason: m.reason };
  return null;
};

function setup(now = () => 0) {
  const servers = fakeServers();
  const events = { ready: [] as string[], gaveUp: [] as string[], restarts: [] as number[] };
  const supervisor = createSupervisor({
    start: servers.start,
    parseMessage,
    now,
    onReady: (url) => events.ready.push(url),
    onGiveUp: (reason) => events.gaveUp.push(reason),
    onRestart: (_, attempt) => events.restarts.push(attempt),
  });
  return { servers, events, supervisor };
}

describe('NFR-01 デスクトップアプリがサーバーを見守る', () => {
  it('サーバーが待ち受けを始めたと知らせたら、その URL を知らせる', () => {
    const { servers, events, supervisor } = setup();
    supervisor.start();
    servers.started[0]?.send({ type: 'ready', url: 'http://127.0.0.1:4820' });
    expect(events.ready).toEqual(['http://127.0.0.1:4820']);
    expect(supervisor.isRunning()).toBe(true);
  });

  it('形の違う知らせは無視する', () => {
    const { servers, events, supervisor } = setup();
    supervisor.start();
    servers.started[0]?.send({ type: 'ready' });
    servers.started[0]?.send('ready');
    expect(events.ready).toEqual([]);
  });

  it('異常終了したら起動し直す', () => {
    const { servers, events, supervisor } = setup();
    supervisor.start();
    servers.started[0]?.exit(1);
    expect(servers.started).toHaveLength(2);
    expect(events.restarts).toEqual([1]);
    expect(supervisor.isRunning()).toBe(true);
  });

  it('1分の間に4回落ちたら、起動し直すのを諦めて理由を知らせる', () => {
    let t = 0;
    const { servers, events, supervisor } = setup(() => t);
    supervisor.start();
    for (let i = 0; i < 4; i++) {
      t += 10_000;
      servers.started.at(-1)?.exit(1);
    }
    expect(servers.started).toHaveLength(4);
    expect(events.gaveUp).toEqual([
      'サーバーが 60 秒の間に 4 回止まったため、起動し直すのをやめました（最後の終了コード 1）',
    ]);
    expect(supervisor.hasGivenUp()).toBe(true);
  });

  it('落ちる間隔が1分より長ければ、何度でも起動し直す', () => {
    let t = 0;
    const { servers, events, supervisor } = setup(() => t);
    supervisor.start();
    for (let i = 0; i < 6; i++) {
      t += 61_000;
      servers.started.at(-1)?.exit(1);
    }
    expect(servers.started).toHaveLength(7);
    expect(events.gaveUp).toEqual([]);
  });

  it('サーバーが起動できないと知らせたら（ポートが使用中など）、起動し直さずにその理由を知らせる', () => {
    const { servers, events, supervisor } = setup();
    supervisor.start();
    servers.started[0]?.send({ type: 'fatal', reason: 'ポート 4820 は使用中です' });
    servers.started[0]?.exit(1);
    expect(servers.started).toHaveLength(1);
    expect(events.gaveUp).toEqual(['ポート 4820 は使用中です']);
  });

  it('アプリの終了で止めたときは、起動し直さない', () => {
    const { servers, events, supervisor } = setup();
    supervisor.start();
    supervisor.stop();
    expect(servers.started[0]?.killed).toBe(true);
    expect(servers.started).toHaveLength(1);
    expect(events.gaveUp).toEqual([]);
    expect(supervisor.isRunning()).toBe(false);
  });
});
