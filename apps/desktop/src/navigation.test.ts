import { describe, expect, it } from 'vitest';
import { isAppUrl, isExternalWebUrl } from './navigation';

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
});
