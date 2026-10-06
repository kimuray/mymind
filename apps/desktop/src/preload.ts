import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type LoginItemState } from './ipc';

/**
 * 画面に渡す、用途を絞った関数だけ（ADR-0015）。ipcRenderer そのものや Node.js の API は渡さない。
 * 画面は window.mymindDesktop があるかどうかで、デスクトップアプリで動いているかを知る
 */
contextBridge.exposeInMainWorld('mymindDesktop', {
  getLoginItem: (): Promise<LoginItemState> => ipcRenderer.invoke(IPC.getLoginItem),
  setLoginItem: (enabled: boolean): Promise<LoginItemState> =>
    ipcRenderer.invoke(IPC.setLoginItem, enabled === true),
});
