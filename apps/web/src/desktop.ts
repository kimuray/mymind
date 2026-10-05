/**
 * デスクトップアプリ（apps/desktop）の preload が渡す関数（ADR-0015）。
 * ブラウザで開いているときはない。値は preload から来るが、画面の外のものなので形を確かめてから使う
 */
export type LoginItemState = { available: boolean; enabled: boolean };

export type DesktopBridge = {
  getLoginItem: () => Promise<LoginItemState>;
  setLoginItem: (enabled: boolean) => Promise<LoginItemState>;
};

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function';

/** デスクトップアプリで動いていれば、preload の関数を返す。ブラウザでは null */
export function desktopBridge(target: unknown = globalThis): DesktopBridge | null {
  if (typeof target !== 'object' || target === null) return null;
  const bridge: unknown = Reflect.get(target, 'mymindDesktop');
  if (typeof bridge !== 'object' || bridge === null) return null;
  const getLoginItem: unknown = Reflect.get(bridge, 'getLoginItem');
  const setLoginItem: unknown = Reflect.get(bridge, 'setLoginItem');
  if (!isFunction(getLoginItem) || !isFunction(setLoginItem)) return null;
  return {
    getLoginItem: async () => toLoginItemState(await getLoginItem()),
    setLoginItem: async (enabled) =>
      toLoginItemState(await (setLoginItem as (e: boolean) => unknown)(enabled)),
  };
}

/** 形の違う値は「切り替えられない」として扱う */
export function toLoginItemState(value: unknown): LoginItemState {
  if (typeof value !== 'object' || value === null) return { available: false, enabled: false };
  const available: unknown = Reflect.get(value, 'available');
  const enabled: unknown = Reflect.get(value, 'enabled');
  return {
    available: available === true,
    enabled: available === true && enabled === true,
  };
}
