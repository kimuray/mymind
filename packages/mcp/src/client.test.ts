import { describe, expect, it } from 'vitest';
import { loadConnection } from './client';

describe('FR-M03 サーバーへのつなぎ方の読み込み', () => {
  it('データディレクトリのセッショントークンを読み、ポートは MYMIND_PORT（既定 4820）', () => {
    const read: string[] = [];
    const conn = loadConnection(
      { MYMIND_DATA_DIR: '/data/mymind', MYMIND_PORT: '4831' },
      (path) => {
        read.push(path);
        return 'token-value\n';
      },
    );
    expect(conn).toEqual({ baseUrl: 'http://127.0.0.1:4831', token: 'token-value' });
    expect(read).toEqual(['/data/mymind/session-token']);
    expect(loadConnection({ MYMIND_DATA_DIR: '/d' }, () => 't').baseUrl).toBe(
      'http://127.0.0.1:4820',
    );
  });

  it('トークンがなければ null にする（まだサーバーを起動したことがない）', () => {
    const conn = loadConnection({ MYMIND_DATA_DIR: '/d' }, () => {
      throw new Error('ENOENT');
    });
    expect(conn.token).toBeNull();
  });
});
