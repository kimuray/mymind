import { describe, expect, it } from 'vitest';
import { isAppUrl, isExpectedServerUrl, isExternalWebUrl, serverPort } from './navigation';

const origins = ['http://127.0.0.1:4820'];

describe('NFR-02 デスクトップアプリのウィンドウで開いてよい URL', () => {
  it.each([
    ['http://127.0.0.1:4820/morning', true],
    ['http://127.0.0.1:4820/', true],
    ['http://localhost:4820/', false],
    ['http://127.0.0.1:5173/', false],
    ['https://example.com/', false],
    ['file:///etc/passwd', false],
    ['これは URL ではない', false],
  ])('%s をウィンドウで開くか：%s', (url, expected) => {
    expect(isAppUrl(url, origins)).toBe(expected);
  });

  it('開発時は Vite のオリジンも許す', () => {
    expect(isAppUrl('http://127.0.0.1:5173/', [...origins, 'http://127.0.0.1:5173'])).toBe(true);
  });

  it.each([
    ['https://example.com/', true],
    ['http://example.com/', true],
    ['file:///Applications', false],
    ['javascript:alert(1)', false],
    ['mailto:a@example.com', false],
  ])('%s を既定のブラウザで開くか：%s', (url, expected) => {
    expect(isExternalWebUrl(url)).toBe(expected);
  });

  it.each([
    ['http://127.0.0.1:4820', true],
    ['http://127.0.0.1:4820/', true],
    ['http://127.0.0.1:4821', false],
    ['http://localhost:4820', false],
    ['https://127.0.0.1:4820', false],
    ['http://example.com:4820', false],
    ['http://127.0.0.1:4820/morning', false],
    ['これは URL ではない', false],
  ])('サーバーが知らせた %s を、ポート 4820 の待ち受けとして受け付けるか：%s', (url, expected) => {
    expect(isExpectedServerUrl(url, 4820)).toBe(expected);
  });

  it('ポートは MYMIND_PORT から決め、なければ（または正しくなければ）4820', () => {
    expect(serverPort({ MYMIND_PORT: '4851' })).toBe(4851);
    expect(serverPort({})).toBe(4820);
    expect(serverPort({ MYMIND_PORT: 'abc' })).toBe(4820);
  });
});
