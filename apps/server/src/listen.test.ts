import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { listen, type RunningServer } from './listen';

const app = () => createApp({ ports: [0], sessionToken: 'token' });

let blocker: Server | undefined;
let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  blocker?.close();
  running = undefined;
  blocker = undefined;
});

/** 空いているポートを1つ占有し、その番号を返す */
function occupyPort(): Promise<number> {
  return new Promise((done) => {
    blocker = createServer().listen(0, '127.0.0.1', () => {
      const address = blocker?.address();
      if (address && typeof address === 'object') done(address.port);
    });
  });
}

describe('NFR-02 待ち受け', () => {
  it('ポートが使用中なら、別のポートを探さずに失敗を返す', async () => {
    const port = await occupyPort();
    expect(await listen(app(), '127.0.0.1', port)).toEqual({
      ok: false,
      error: { kind: 'port_in_use', port },
    });
  });

  it('空いているポートなら待ち受けを始める', async () => {
    const port = await occupyPort();
    await new Promise((done) => blocker?.close(done));
    blocker = undefined;
    const result = await listen(app(), '127.0.0.1', port);
    expect(result.ok).toBe(true);
    if (result.ok) running = result.value;
  });
});
