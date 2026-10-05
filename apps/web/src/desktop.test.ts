import { describe, expect, it } from 'vitest';
import { changeLoginItem, type DesktopBridge, desktopBridge, toLoginItemState } from './desktop';

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

  it('変えるのに失敗したら、実際の設定を読み直して返す', async () => {
    const bridge: DesktopBridge = {
      getLoginItem: async () => ({ available: true, enabled: true }),
      setLoginItem: async () => {
        throw new Error('OS の設定を変えられませんでした');
      },
    };
    expect(await changeLoginItem(bridge, { available: true, enabled: true }, false)).toEqual({
      state: { available: true, enabled: true },
      failed: true,
    });
  });

  it('読み直せもしなければ、変える前の状態に戻す', async () => {
    const bridge: DesktopBridge = {
      getLoginItem: async () => {
        throw new Error('読めない');
      },
      setLoginItem: async () => {
        throw new Error('変えられない');
      },
    };
    expect(await changeLoginItem(bridge, { available: true, enabled: false }, true)).toEqual({
      state: { available: true, enabled: false },
      failed: true,
    });
  });

  it('変えられたら、その結果を返す', async () => {
    const bridge: DesktopBridge = {
      getLoginItem: async () => ({ available: true, enabled: false }),
      setLoginItem: async (enabled) => ({ available: true, enabled }),
    };
    expect(await changeLoginItem(bridge, { available: true, enabled: false }, true)).toEqual({
      state: { available: true, enabled: true },
      failed: false,
    });
  });
});
