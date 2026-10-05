import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('NFR-02 起動の設定', () => {
  it('何も指定しなければ 127.0.0.1:4820 で待ち受け、~/.mymind を使う', () => {
    expect(loadConfig({})).toEqual({
      ok: true,
      value: {
        dataDir: join(homedir(), '.mymind'),
        host: '127.0.0.1',
        port: 4820,
        devPorts: [],
        agent: {
          name: 'claude',
          model: null,
          timeoutMs: 120_000,
          fakeMode: 'success',
          fakeDelayMs: 800,
        },
        paths: { webDist: null, prompts: null, migrations: null },
        desktop: false,
      },
    });
  });

  it('MYMIND_DATA_DIR と MYMIND_PORT を指定できる', () => {
    const result = loadConfig({ MYMIND_DATA_DIR: './.data', MYMIND_PORT: '5000' });
    expect(result).toEqual({
      ok: true,
      value: {
        dataDir: resolve('./.data'),
        host: '127.0.0.1',
        port: 5000,
        devPorts: [],
        agent: {
          name: 'claude',
          model: null,
          timeoutMs: 120_000,
          fakeMode: 'success',
          fakeDelayMs: 800,
        },
        paths: { webDist: null, prompts: null, migrations: null },
        desktop: false,
      },
    });
  });

  it('コンテナの外で 0.0.0.0 を指定すると起動を拒否する', () => {
    expect(loadConfig({ MYMIND_HOST: '0.0.0.0' })).toEqual({
      ok: false,
      error: { kind: 'all_interfaces_outside_container' },
    });
  });

  it('コンテナの中なら 0.0.0.0 で待ち受けられる', () => {
    const result = loadConfig({ MYMIND_HOST: '0.0.0.0', MYMIND_IN_CONTAINER: '1' });
    expect(result).toMatchObject({ ok: true, value: { host: '0.0.0.0' } });
  });

  it.each(['localhost', '192.168.0.10', '::'])('MYMIND_HOST=%s は受け付けない', (host) => {
    expect(loadConfig({ MYMIND_HOST: host })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_env' },
    });
  });

  it.each(['0', '65536', 'abc', '80.5'])('MYMIND_PORT=%s は受け付けない', (port) => {
    expect(loadConfig({ MYMIND_PORT: port })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_env' },
    });
  });
  it('開発時は MYMIND_VITE_PORT で Vite のポートを受け取る', () => {
    expect(loadConfig({ MYMIND_VITE_PORT: '5173' })).toMatchObject({
      ok: true,
      value: { port: 4820, devPorts: [5173] },
    });
  });

  it('MYMIND_VITE_PORT が不正なら受け付けない', () => {
    expect(loadConfig({ MYMIND_VITE_PORT: 'vite' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_env' },
    });
  });

  it('FB のエージェントと、偽のアダプタの振る舞いを選べる（FR-A07）', () => {
    expect(
      loadConfig({
        MYMIND_AGENT: 'fake',
        MYMIND_FAKE_AGENT_MODE: 'hang',
        MYMIND_FAKE_AGENT_DELAY_MS: '0',
      }),
    ).toMatchObject({
      ok: true,
      value: { agent: { name: 'fake', fakeMode: 'hang', fakeDelayMs: 0 } },
    });
  });

  it('エージェントに使わせるモデルを指定でき、省略すると null（各 CLI の設定に従う）', () => {
    expect(
      loadConfig({ MYMIND_AGENT: 'codex', MYMIND_AGENT_MODEL: 'gpt-5.6-terra' }),
    ).toMatchObject({
      ok: true,
      value: { agent: { name: 'codex', model: 'gpt-5.6-terra' } },
    });
    expect(loadConfig({ MYMIND_AGENT: 'codex' })).toMatchObject({
      ok: true,
      value: { agent: { model: null } },
    });
  });

  it('FB の生成を待つ秒数を変えられ、10〜600 秒の外は受け付けない（#23）', () => {
    expect(loadConfig({ MYMIND_AGENT_TIMEOUT_SEC: '300' })).toMatchObject({
      ok: true,
      value: { agent: { timeoutMs: 300_000 } },
    });
    expect(loadConfig({ MYMIND_AGENT_TIMEOUT_SEC: '5' })).toMatchObject({ ok: false });
  });

  it('知らないエージェントは受け付けない', () => {
    expect(loadConfig({ MYMIND_AGENT: 'gpt' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_env' },
    });
  });
});

describe('NFR-01 デスクトップアプリから渡す設定', () => {
  it('成果物の場所とデスクトップアプリで動いていることを受け取る', () => {
    expect(
      loadConfig({
        MYMIND_WEB_DIST: '/app/Resources/web',
        MYMIND_PROMPTS_DIR: '/app/Resources/prompts',
        MYMIND_MIGRATIONS_DIR: '/app/Resources/migrations',
        MYMIND_DESKTOP: '1',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        paths: {
          webDist: '/app/Resources/web',
          prompts: '/app/Resources/prompts',
          migrations: '/app/Resources/migrations',
        },
        desktop: true,
      },
    });
  });

  it('成果物の場所が相対パスなら起動を拒否する', () => {
    expect(loadConfig({ MYMIND_WEB_DIST: 'web/dist' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid_env' },
    });
  });

  it('NFR-02 デスクトップアプリの子プロセスでは、コンテナの指定があっても 0.0.0.0 を拒否する', () => {
    expect(
      loadConfig({ MYMIND_HOST: '0.0.0.0', MYMIND_IN_CONTAINER: '1', MYMIND_DESKTOP: '1' }),
    ).toEqual({ ok: false, error: { kind: 'all_interfaces_outside_container' } });
  });
});
