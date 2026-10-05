import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { runProcess } from '@mymind/agent';
import type { Notification, NotificationKind } from '@mymind/domain';
import type { EventBus } from './events';
import type { Logger } from './logger';
import type { NotificationAdapter } from './notifications';

/** 通知を出す手段（architecture.md 9.2）。この順に、使えるものを選ぶ */
export type NotificationChannelName = 'desktop' | 'macos' | 'browser' | 'banner';

export type NotificationChannel = NotificationAdapter & {
  name: NotificationChannelName;
  /** 今この手段で出せるか */
  isAvailable: () => boolean;
};

/** 通知のコマンドを動かした結果 */
export type CommandResult = { ok: true } | { ok: false; message: string };

/** 通知のコマンドの名前（URL を開ける macOS の通知、FR-N05） */
export const NOTIFIER_COMMAND = 'terminal-notifier';

/**
 * launchd から起動すると PATH が短く、Homebrew の場所が入らないので、よく使われる場所も探す
 */
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    // 見つからない、または実行できない。どちらも「使えない」として次の場所を探す
    return false;
  }
};

/** PATH とよく使われる場所から、実行できるコマンドのパスを探す。見つからなければ null */
export function findExecutable(
  name: string,
  pathEnv: string | undefined,
  canExecute: (path: string) => boolean = isExecutable,
): string | null {
  const dirs = [...(pathEnv ?? '').split(delimiter).filter((d) => d !== ''), ...EXTRA_DIRS];
  for (const dir of new Set(dirs)) {
    const path = join(dir, name);
    if (canExecute(path)) return path;
  }
  return null;
}

/**
 * コマンドを、シェルを通さずに引数の配列で動かす（通知文にどんな文字があっても、コマンドとして解釈させない）。
 * 子プロセスは packages/agent の runProcess だけで起動する（依存方向の規則）。
 * 失敗の理由には引数（タスク名を含む通知文）や出力を入れない。ログに残るため
 */
export async function runCommand(file: string, args: readonly string[]): Promise<CommandResult> {
  const signal = AbortSignal.timeout(10_000);
  const result = await runProcess(file, args, {
    stdin: '',
    cwd: process.cwd(),
    env: process.env,
    signal,
  });
  if (result.exitCode === 0) return { ok: true };
  const reason = result.notFound
    ? '見つかりません'
    : result.aborted
      ? '10秒以内に終わりませんでした'
      : `終了コード ${String(result.exitCode)}`;
  return { ok: false, message: `${file} が失敗しました（${reason}）` };
}

/** 通知のコマンドに渡す引数。クリックすると、その種類の画面を開く */
export function notifierArgs(notification: Notification, baseUrl: string): string[] {
  return [
    '-title',
    'mymind',
    '-subtitle',
    notification.title,
    '-message',
    notification.body,
    '-open',
    `${baseUrl}${notification.path}`,
    // 同じ種類の古い通知は、新しい通知で置き換える
    '-group',
    `mymind-${notification.kind}`,
  ];
}

/**
 * デスクトップアプリの OS の通知（ADR-0015、FR-N05）。メインプロセスに頼み、出せたかの返事を待つ。
 * デスクトップアプリの子プロセスとして動いているときだけ使う
 */
export function createDesktopChannel(notifier: {
  notify: (notification: Notification) => Promise<CommandResult>;
}): NotificationChannel {
  return {
    name: 'desktop',
    isAvailable: () => true,
    notify: (notification) => notifier.notify(notification),
  };
}

/** macOS の通知（terminal-notifier）。コマンドが見つかるときだけ使う */
export function createMacosChannel(deps: {
  command: () => string | null;
  baseUrl: string;
  run?: (file: string, args: readonly string[]) => Promise<CommandResult>;
}): NotificationChannel {
  const run = deps.run ?? runCommand;
  return {
    name: 'macos',
    isAvailable: () => deps.command() !== null,
    notify: async (notification) => {
      const command = deps.command();
      if (command === null) return { ok: false, message: `${NOTIFIER_COMMAND} が見つかりません` };
      return run(command, notifierArgs(notification, deps.baseUrl));
    },
  };
}

/** ブラウザの通知の許可の状態（Notification.permission）。通知の API がないブラウザは unsupported */
export const BROWSER_PERMISSIONS = ['default', 'granted', 'denied', 'unsupported'] as const;
export type BrowserPermission = (typeof BROWSER_PERMISSIONS)[number];

/** 画面が知らせてきた、ブラウザの通知の許可の状態。まだ知らされていなければ null */
export function createBrowserPermissionState() {
  let permission: BrowserPermission | null = null;
  return {
    get: () => permission,
    report: (next: BrowserPermission) => {
      permission = next;
    },
  };
}

export type BrowserPermissionState = ReturnType<typeof createBrowserPermissionState>;

/**
 * ブラウザの通知。アプリを開いているタブがあり、通知が許可されているときだけ使う。
 * サーバーは SSE で知らせ、画面が Notification API で出す
 */
export function createBrowserChannel(deps: {
  events: EventBus;
  permission: BrowserPermissionState;
}): NotificationChannel {
  return {
    name: 'browser',
    isAvailable: () => deps.permission.get() === 'granted' && deps.events.subscriberCount() > 0,
    notify: async (notification) => {
      deps.events.publish({ type: 'notification.show', notification });
      return { ok: true };
    },
  };
}

/** 画面のバナーに出す、まだ閉じていない通知。種類ごとに新しいものだけを持つ（サーバーを止めると消える） */
export function createPendingNotifications(now: () => Date) {
  const pending = new Map<NotificationKind, Notification & { at: string }>();
  return {
    add(notification: Notification) {
      pending.set(notification.kind, { ...notification, at: now().toISOString() });
    },
    list: () => [...pending.values()].sort((a, b) => a.at.localeCompare(b.at)),
    dismiss: (kind: NotificationKind) => pending.delete(kind),
  };
}

export type PendingNotifications = ReturnType<typeof createPendingNotifications>;

/** 画面のバナー。ほかの手段が使えないときの最後の手段で、いつでも使える。開いている画面にはすぐ知らせる */
export function createBannerChannel(deps: {
  pending: PendingNotifications;
  events: EventBus;
}): NotificationChannel {
  return {
    name: 'banner',
    isAvailable: () => true,
    notify: async (notification) => {
      deps.pending.add(notification);
      deps.events.publish({ type: 'notifications.changed' });
      return { ok: true };
    },
  };
}

/** 今使える手段のうち、最初のもの（状態の画面に出す） */
export const activeChannel = (
  channels: readonly NotificationChannel[],
): NotificationChannelName | null => channels.find((c) => c.isAvailable())?.name ?? null;

/**
 * 手段を順に試す通知のアダプタ（architecture.md 9.2）。使える手段で出せなかったら、次の手段で出す
 */
export function createNotificationRouter(
  channels: readonly NotificationChannel[],
  logger: Logger,
): NotificationAdapter {
  return {
    notify: async (notification) => {
      const failures: string[] = [];
      for (const channel of channels) {
        if (!channel.isAvailable()) continue;
        const result = await channel.notify(notification);
        if (result.ok) return result;
        logger.warn('通知を出せなかったので、次の手段で出します', {
          kind: notification.kind,
          channel: channel.name,
          error: result.message,
        });
        failures.push(`${channel.name}: ${result.message}`);
      }
      return { ok: false, message: failures.join(' / ') || '使える手段がありません' };
    },
  };
}
