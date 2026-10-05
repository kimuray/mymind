import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopMessageSchema } from '@mymind/server/desktop-bridge';
import { app, BrowserWindow, dialog, shell, utilityProcess } from 'electron';
import { isAppUrl, isExternalWebUrl } from './navigation';
import { resolveResources, serverEnv } from './resources';
import { createSupervisor, type ServerProcess } from './supervisor';

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

/** ウィンドウの中で開いてよいオリジン。開発時は画面を Vite が配信する（ADR-0007） */
const allowedOrigins = (): string[] => {
  const origins = serverUrl === null ? [] : [new URL(serverUrl).origin];
  const vitePort = process.env['MYMIND_VITE_PORT'];
  if (vitePort !== undefined) origins.push(`http://127.0.0.1:${vitePort}`);
  return origins;
};

function openWindow(url: string) {
  if (mainWindow !== null) {
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
      // 画面に Node.js の API を渡さない（ADR-0015）
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
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
  });
  mainWindow = window;
  void window.loadURL(url);
}

const startServer = (): ServerProcess => {
  const child = utilityProcess.fork(resources.serverEntry, [], {
    serviceName: 'mymind-server',
    env: serverEnv(process.env, resources),
    stdio: 'inherit',
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
    return parsed.success ? parsed.data : null;
  },
  now: () => Date.now(),
  onReady: (url) => {
    serverUrl = url;
    // 起動し直したときは、開いているウィンドウを読み直す
    if (mainWindow !== null) void mainWindow.loadURL(url);
    else openWindow(url);
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
  app.on('second-instance', () => {
    if (serverUrl !== null) openWindow(serverUrl);
  });
  app.whenReady().then(() => {
    supervisor.start();
    app.on('activate', () => {
      if (serverUrl !== null) openWindow(serverUrl);
    });
  });
  app.on('before-quit', () => {
    quitting = true;
    supervisor.stop();
  });
  // ウィンドウを閉じたら終了する。メニューバーに残す常駐は #207 で作る
  app.on('window-all-closed', () => app.quit());
}
