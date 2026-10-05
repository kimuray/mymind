import { afterEach, describe, expect, it, vi } from 'vitest';
import { showBrowserNotification } from './realtime';

/** ブラウザの Notification の代わり。作られた通知を覚える */
function stubNotification(permission: NotificationPermission) {
  const created: { title: string; options: NotificationOptions; instance: FakeNotification }[] = [];
  class FakeNotification {
    static permission = permission;
    onclick: (() => void) | null = null;
    closed = false;
    constructor(title: string, options: NotificationOptions) {
      created.push({ title, options, instance: this });
    }
    close() {
      this.closed = true;
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  const focus = vi.fn();
  vi.stubGlobal('window', { focus });
  return { created, focus };
}

afterEach(() => vi.unstubAllGlobals());

const evening = {
  kind: 'evening',
  title: '振り返り',
  body: '今日は3件完了',
  path: '/reflection',
};

describe('FR-N05 ブラウザの通知', () => {
  it('許可されていれば、種類ごとの tag を付けて出し、クリックでタブを前に出してその画面を開く', () => {
    const { created, focus } = stubNotification('granted');
    const opened: string[] = [];
    showBrowserNotification(evening, (path) => opened.push(path));
    expect(created.map((c) => [c.title, c.options])).toEqual([
      ['振り返り', { body: '今日は3件完了', tag: 'mymind-evening' }],
    ]);
    created[0]?.instance.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(opened).toEqual(['/reflection']);
    expect(created[0]?.instance.closed).toBe(true);
  });

  it('許可されていなければ出さない', () => {
    const { created } = stubNotification('default');
    showBrowserNotification(evening, () => {});
    expect(created).toEqual([]);
  });
});
