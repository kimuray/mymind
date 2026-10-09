import { homedir } from 'node:os';
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
  screen,
  shell,
  Tray,
  utilityProcess,
} from 'electron';
import { buildAppMenu } from './appMenu';
import { BUILD_INFO_FILE, readBuildInfo } from './buildInfo';
import { initLoginItemOnce, readDesktopState, writeDesktopState } from './desktopState';
import { IPC, type LoginItemState } from './ipc';
import { isAppUrl, isExpectedServerUrl, isExternalWebUrl, serverPort } from './navigation';
import { handleNotifyRequest } from './notifications';
import { resolveResources, serverEnv } from './resources';
import { createSupervisor, type ServerProcess } from './supervisor';
import { buildTrayMenu } from './tray';
import {
  buildUpdateEnv,
  createGitRunner,
  pruneUpdateLogs,
  startUpdateScript,
  updateLogName,
} from './updateCommands';
import { checkForUpdate, createUpdater, type Updater } from './updater';
import { fitWindowBounds, MIN_WINDOW, readWindowBounds, writeWindowBounds } from './windowState';

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
// アップデートの確認と適用。.app を作ったときの情報がないとき（開発時の起動）は null で、メニューに出さない
let updater: Updater | null = null;
let updateLogPath: string | null = null;

/** 更新を確かめる間隔。起動の直後はサーバーの起動を優先して少し待つ（FR-U05） */
const UPDATE_FIRST_CHECK_MS = 60_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
  // 前に閉じたときの大きさと位置で開く。外したディスプレイの上にあったときは、いちばん目の画面に戻す（DESIGN.md 3.1）
  const boundsPath = join(app.getPath('userData'), 'window-state.json');
  const bounds = fitWindowBounds(
    readWindowBounds(boundsPath),
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
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
  // 大きさと位置を覚える（フルスクリーンやしまったときは、元の大きさ）。閉じる直前だけでなく、
  // 変えたときにも少し待ってから覚える（アプリが強制終了しても、最後の大きさで開けるように）
  const saveBounds = () => {
    try {
      writeWindowBounds(boundsPath, window.getNormalBounds());
    } catch (e) {
      console.warn('ウィンドウの大きさと位置を覚えられませんでした', e);
    }
  };
  let saveTimer: NodeJS.Timeout | null = null;
  const saveSoon = () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveBounds, 500);
  };
  window.on('resize', saveSoon);
  window.on('move', saveSoon);
  window.on('close', () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveBounds();
  });
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
  refreshTrayMenu();
}

/** メニューを作り直す。アップデートの状態が変わるたびに呼ぶ */
function refreshTrayMenu() {
  if (tray === null) return;
  const current = updater;
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenu({
        open: () => openWindow(),
        openPath: (path) => openWindow(path),
        quit: () => app.quit(),
        ...(current === null
          ? {}
          : {
              update: {
                state: current.getState(),
                check: () => void current.check({ manual: true }),
                apply: () => void confirmUpdate(),
                openLog: () => {
                  if (updateLogPath !== null) void shell.openPath(updateLogPath);
                },
              },
            }),
      }),
    ),
  );
}

/**
 * アップデートの確認と適用を用意する（FR-U05、ADR-0017）。更新元は .app を作った手元のリポジトリ。
 * .app を作ったときの情報がなければ（開発時の起動、git のない環境で作った .app）、更新の項目を出さない
 */
function initUpdater() {
  const read = readBuildInfo(join(appDir, BUILD_INFO_FILE));
  if (read.kind !== 'ok') {
    if (read.kind === 'invalid') console.warn(`${BUILD_INFO_FILE} を読めません（${read.reason}）`);
    return;
  }
  const { commit, repoPath } = read.info;
  const env = buildUpdateEnv(process.env, homedir());
  const runGit = createGitRunner({ repoPath, env });
  updater = createUpdater({
    check: () => checkForUpdate(runGit, commit),
    startUpdate: () => {
      const logDir = app.getPath('logs');
      const now = new Date();
      pruneUpdateLogs(logDir, now);
      updateLogPath = join(logDir, updateLogName(now));
      return startUpdateScript({ repoPath, env, logPath: updateLogPath });
    },
    notify: ({ title, body }) => {
      if (!Notification.isSupported()) return;
      const notice = new Notification({ title, body });
      // アップデートがあるという通知を選んだら、更新するかを尋ねる
      notice.on('click', () => {
        if (updater?.getState().kind === 'available') void confirmUpdate();
      });
      notice.show();
    },
    onChange: () => refreshTrayMenu(),
  });
  const checkQuietly = () => void updater?.check({ manual: false });
  setTimeout(checkQuietly, UPDATE_FIRST_CHECK_MS);
  setInterval(checkQuietly, UPDATE_CHECK_INTERVAL_MS);
}

/** 更新するかを尋ねてから適用する。ビルドに数分かかり、終わると再起動するため */
async function confirmUpdate() {
  const state = updater?.getState();
  if (updater === null || state?.kind !== 'available') return;
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['再起動して更新', 'あとで'],
    defaultId: 0,
    cancelId: 1,
    message: 'mymind を更新しますか？',
    detail: `${state.commits} 件の変更があります。手元のリポジトリで pnpm update-app を動かし、ビルドが終わると mymind が再起動します（数分かかります。そのあいだも使えます）。`,
  });
  if (response === 0) updater.apply();
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
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: enabled });
      // 利用者が選んだので、次の起動で「初めて」としてオンに戻さない（書けなくても選んだ設定は保つ）
      try {
        writeDesktopState(join(app.getPath('userData'), 'desktop-state.json'), {
          loginItemInitialized: true,
        });
      } catch (e) {
        console.warn('デスクトップアプリの状態を書けませんでした', e);
      }
    }
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
  const result = initLoginItemOnce({
    isPackaged: app.isPackaged,
    read,
    write: (state) => writeDesktopState(statePath, state),
    enable: () => app.setLoginItemSettings({ openAtLogin: true }),
  });
  if (typeof result === 'object') {
    console.warn(
      `デスクトップアプリの状態を書けないので、ログイン時の起動は変えません（${result.failed}）`,
    );
  }
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
  app.setName('mymind');
  app.whenReady().then(() => {
    // 画面のショートカットと重ならないメニュー（DESIGN.md 3.1、FR-U01）
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenu({ isDev: !app.isPackaged })));
    // .app では Info.plist のアイコンを使う。開発時の Dock にもマメを出す
    if (!app.isPackaged) app.dock?.setIcon(join(resources.assets, 'icon.png'));
    registerIpc();
    initLoginItem();
    initUpdater();
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
