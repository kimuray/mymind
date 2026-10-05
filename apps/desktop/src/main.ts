import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopMessageSchema } from '@mymind/server/desktop-bridge';

import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  Notification,
  nativeImage,
  shell,
  Tray,
  utilityProcess,
} from 'electron';
import {
  readDesktopState,
  shouldEnableLoginItemOnFirstRun,
  writeDesktopState,
} from './desktopState';
import { IPC, type LoginItemState } from './ipc';
import { isAppUrl, isExpectedServerUrl, isExternalWebUrl, serverPort } from './navigation';
import { handleNotifyRequest } from './notifications';
import { resolveResources, serverEnv } from './resources';
import { createSupervisor, type ServerProcess } from './supervisor';
import { buildTrayMenu } from './tray';

/**
 * デスクトップアプリのメインプロセス（ADR-0015）。
 * サーバーを子プロセス（utilityProcess）で動かして見守り、待ち受けを始めたらウィンドウで画面を開く
 */

// dist/main.mjs から見た apps/desktop
const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const resources = resolveResources({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appDir,
});

let mainWindow: BrowserWindow | null = null;
let serverUrl: string | null = null;
let quitting = false;
// メニューバーのアイコン。参照を持っておかないと、ガベージコレクションで消える
let tray: Tray | null = null;

/** ウィンドウの中で開いてよいオリジン。開発時は画面を Vite が配信する（ADR-0007） */
const allowedOrigins = (): string[] => {
  const origins = serverUrl === null ? [] : [new URL(serverUrl).origin];
  const vitePort = process.env['MYMIND_VITE_PORT'];
  if (vitePort !== undefined) origins.push(`http://127.0.0.1:${vitePort}`);
  return origins;
};

/**
 * ウィンドウを開く。path を渡したらその画面へ移る。閉じていれば作り直す（閉じたウィンドウは破棄してメモリを抑える）。
 * ウィンドウがある間だけ Dock にアイコンを出す（NFR-27、DESIGN.md 3.1）
 */
function openWindow(path?: string) {
  if (serverUrl === null) return;
  const url = path === undefined ? serverUrl : new URL(path, serverUrl).toString();
  void app.dock?.show();
  if (mainWindow !== null) {
    if (path !== undefined) void mainWindow.loadURL(url);
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'mymind',
    show: false,
    webPreferences: {
      // 画面に Node.js の API を渡さない。preload で用途を絞った関数だけを渡す（ADR-0015）
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(appDir, 'dist', 'preload.cjs'),
    },
  });
  // アプリの外の URL へは移らせず、外部のリンクは既定のブラウザで開く
  window.webContents.on('will-navigate', (event, target) => {
    if (isAppUrl(target, allowedOrigins())) return;
    event.preventDefault();
    if (isExternalWebUrl(target)) void shell.openExternal(target);
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isExternalWebUrl(target) && !isAppUrl(target, allowedOrigins())) {
      void shell.openExternal(target);
    }
    return { action: 'deny' };
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    mainWindow = null;
    // ウィンドウを閉じてもアプリとサーバーは動き続ける。Dock からは消し、メニューバーから開き直す
    app.dock?.hide();
  });
  mainWindow = window;
  void window.loadURL(url);
}

/** メニューバーのアイコンとメニュー（NFR-27） */
function createTray() {
  const icon = nativeImage.createFromPath(join(resources.assets, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('mymind');
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenu({
        open: () => openWindow(),
        openPath: (path) => openWindow(path),
        quit: () => app.quit(),
      }),
    ),
  );
}

/** ログイン時の起動の状態。開発時（electron .）は、Electron の本体を登録してしまうので切り替えさせない */
const loginItemState = (): LoginItemState => ({
  available: app.isPackaged,
  enabled: app.isPackaged && app.getLoginItemSettings().openAtLogin,
});

/** 画面からの依頼は、アプリの画面（サーバーと同じオリジン）からのものだけを受け付ける */
const isFromApp = (event: IpcMainInvokeEvent) =>
  event.senderFrame !== null && isAppUrl(event.senderFrame.url, allowedOrigins());

function registerIpc() {
  ipcMain.handle(IPC.getLoginItem, (event) => {
    if (!isFromApp(event)) throw new Error('アプリの画面からの依頼ではありません');
    return loginItemState();
  });
  ipcMain.handle(IPC.setLoginItem, (event, enabled: unknown) => {
    if (!isFromApp(event)) throw new Error('アプリの画面からの依頼ではありません');
    if (typeof enabled !== 'boolean') throw new Error('オン・オフを指定してください');
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled });
    return loginItemState();
  });
}

/** 初回の起動でだけ、ログイン時の起動をオンにする（オフにしたあとは戻さない、NFR-27） */
function initLoginItem() {
  const statePath = join(app.getPath('userData'), 'desktop-state.json');
  const read = readDesktopState(statePath);
  if (read.kind === 'invalid') {
    console.warn(
      `デスクトップアプリの状態を読めないので、ログイン時の起動は変えません（${read.reason}）`,
    );
    return;
  }
  if (!shouldEnableLoginItemOnFirstRun({ isPackaged: app.isPackaged, read })) return;
  app.setLoginItemSettings({ openAtLogin: true });
  writeDesktopState(statePath, { loginItemInitialized: true });
}

const startServer = (): ServerProcess => {
  const child = utilityProcess.fork(resources.serverEntry, [], {
    serviceName: 'mymind-server',
    env: serverEnv(process.env, resources),
    stdio: 'inherit',
  });
  // サーバーからの通知の依頼に答える（FR-N05）。待ち受けの知らせ（ready・fatal）は見守り役が扱う
  child.on('message', (raw) => {
    const parsed = desktopMessageSchema.safeParse(raw);
    if (!parsed.success || parsed.data.type !== 'notify') return;
    child.postMessage(
      handleNotifyRequest(parsed.data, {
        isSupported: () => Notification.isSupported(),
        show: (content, onClick) => {
          const notice = new Notification({ title: content.title, body: content.body });
          notice.on('click', onClick);
          notice.show();
        },
        openPath: (path) => openWindow(path),
      }),
    );
  });
  return {
    onExit: (listener) => child.on('exit', listener),
    onMessage: (listener) => child.on('message', listener),
    kill: () => {
      child.kill();
    },
  };
};

const supervisor = createSupervisor({
  start: startServer,
  parseMessage: (raw) => {
    const parsed = desktopMessageSchema.safeParse(raw);
    if (!parsed.success || parsed.data.type === 'notify') return null;
    // 起動したときに決めた 127.0.0.1 のポートでなければ開かず、起動できなかったことにする（ADR-0007）
    if (
      parsed.data.type === 'ready' &&
      !isExpectedServerUrl(parsed.data.url, serverPort(process.env))
    ) {
      return {
        type: 'fatal',
        reason: `サーバーが知らせた URL（${parsed.data.url}）が想定と違います`,
      };
    }
    return parsed.data;
  },
  now: () => Date.now(),
  onReady: (url) => {
    serverUrl = url;
    // 起動し直したときは、開いているウィンドウを読み直す（新しいセッショントークンの画面にする）
    if (mainWindow !== null) void mainWindow.loadURL(url);
    else openWindow();
  },
  onRestart: (code, attempt) => {
    console.error(`サーバーが止まったので起動し直します（終了コード ${code}、${attempt} 回目）`);
  },
  onGiveUp: (reason) => {
    console.error(reason);
    if (quitting) return;
    dialog.showErrorBox('mymind を起動できません', reason);
    app.quit();
  },
});

// 二重起動を防ぐ。2つ目を起動したら、1つ目のウィンドウを前に出す
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openWindow());
  app.whenReady().then(() => {
    registerIpc();
    initLoginItem();
    createTray();
    supervisor.start();
    app.on('activate', () => openWindow());
  });
  app.on('before-quit', () => {
    quitting = true;
    supervisor.stop();
  });
  // ウィンドウを閉じても終了しない。通知と毎日のバックアップのために、メニューバーに残って動き続ける（NFR-27）
  app.on('window-all-closed', () => {});
}
