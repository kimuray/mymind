import { describe, expect, it } from 'vitest';
import { desktopBridge, toLoginItemState } from './desktop';

describe('NFR-27 デスクトップアプリの preload の関数', () => {
  it('ブラウザ（mymindDesktop がない）では null', () => {
    expect(desktopBridge({})).toBeNull();
    expect(desktopBridge({ mymindDesktop: { getLoginItem: 1 } })).toBeNull();
  });

  it('デスクトップアプリでは、ログイン時の起動を読み書きできる', async () => {
    let enabled = true;
    const bridge = desktopBridge({
      mymindDesktop: {
        getLoginItem: async () => ({ available: true, enabled }),
        setLoginItem: async (next: boolean) => {
          enabled = next;
          return { available: true, enabled };
        },
      },
    });
    expect(await bridge?.getLoginItem()).toEqual({ available: true, enabled: true });
    expect(await bridge?.setLoginItem(false)).toEqual({ available: true, enabled: false });
  });

  it('形の違う値は、切り替えられないものとして扱う', () => {
    expect(toLoginItemState(null)).toEqual({ available: false, enabled: false });
    expect(toLoginItemState({ available: 'yes', enabled: true })).toEqual({
      available: false,
      enabled: false,
    });
    expect(toLoginItemState({ available: false, enabled: true })).toEqual({
      available: false,
      enabled: false,
    });
  });
});
