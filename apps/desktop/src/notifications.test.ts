import { describe, expect, it } from 'vitest';
import { handleNotifyRequest, isAppPath } from './notifications';

const request = (path = '/morning') => ({
  id: 7,
  notification: { kind: 'morning', title: '朝の計画', body: '持ち越しが2件あります', path },
});

describe('FR-N05 デスクトップアプリの OS の通知', () => {
  it('OS の通知を出し、クリックでその画面へ移って、出せたことを返す', () => {
    const shown: { title: string; body: string }[] = [];
    const opened: string[] = [];
    let click: () => void = () => {};
    const reply = handleNotifyRequest(request(), {
      isSupported: () => true,
      show: (content, onClick) => {
        shown.push(content);
        click = onClick;
      },
      openPath: (path) => opened.push(path),
    });
    expect(reply).toEqual({ type: 'notify-result', id: 7, ok: true });
    expect(shown).toEqual([{ title: '朝の計画', body: '持ち越しが2件あります' }]);
    click();
    expect(opened).toEqual(['/morning']);
  });

  it('OS の通知を使えない環境では、出せなかったことを返す', () => {
    expect(
      handleNotifyRequest(request(), {
        isSupported: () => false,
        show: () => {},
        openPath: () => {},
      }),
    ).toEqual({
      type: 'notify-result',
      id: 7,
      ok: false,
      message: 'この環境では OS の通知を使えません',
    });
  });

  it.each([
    ['/morning', true],
    ['/reflection', true],
    ['//example.com/', false],
    ['/\\example.com', false],
    ['https://example.com/', false],
    ['morning', false],
  ])('%s はクリックで移ってよいパスか：%s', (path, expected) => {
    expect(isAppPath(path)).toBe(expected);
  });

  it('アプリの外へのパスなら、通知を出さずに失敗を返す', () => {
    let shown = false;
    const reply = handleNotifyRequest(request('//example.com/'), {
      isSupported: () => true,
      show: () => {
        shown = true;
      },
      openPath: () => {},
    });
    expect(shown).toBe(false);
    expect(reply.ok).toBe(false);
  });
});
