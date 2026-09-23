import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('NFR-02 起動の設定', () => {
  it('何も指定しなければ 127.0.0.1:4820 で待ち受け、~/.mymind を使う', () => {
    expect(loadConfig({})).toEqual({
      ok: true,
      value: { dataDir: join(homedir(), '.mymind'), host: '127.0.0.1', port: 4820 },
    });
  });

  it('MYMIND_DATA_DIR と MYMIND_PORT を指定できる', () => {
    const result = loadConfig({ MYMIND_DATA_DIR: './.data', MYMIND_PORT: '5000' });
    expect(result).toEqual({
      ok: true,
      value: { dataDir: resolve('./.data'), host: '127.0.0.1', port: 5000 },
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
});
