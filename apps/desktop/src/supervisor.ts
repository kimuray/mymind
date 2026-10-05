/** 子プロセスで動かすサーバーの操作。Electron の utilityProcess を包む（テストでは偽物に差し替える） */
export type ServerProcess = {
  /** 終了したら呼ぶ。code は終了コード */
  onExit: (listener: (code: number) => void) => void;
  /** サーバーからの知らせ（検証前） */
  onMessage: (listener: (message: unknown) => void) => void;
  kill: () => void;
};

export type SupervisorEvents = {
  /** サーバーが待ち受けを始めた */
  onReady: (url: string) => void;
  /** 起動し直すのを諦めた。理由を利用者に見せる */
  onGiveUp: (reason: string) => void;
  /** 起動し直す（ログに残す） */
  onRestart?: (code: number, attempt: number) => void;
};

export type SupervisorOptions = {
  start: () => ServerProcess;
  /** サーバーの知らせを検証する。形の違う知らせは null */
  parseMessage: (
    message: unknown,
  ) => { type: 'ready'; url: string } | { type: 'fatal'; reason: string } | null;
  now: () => number;
  /** この時間の中で、この回数を超えて落ちたら諦める */
  maxRestarts?: number;
  windowMs?: number;
} & SupervisorEvents;

export const DEFAULT_MAX_RESTARTS = 3;
export const DEFAULT_RESTART_WINDOW_MS = 60_000;

/**
 * サーバーを子プロセスで動かし、異常終了したら起動し直す（ADR-0015、M5 の常駐の条件）。
 * 短い間に繰り返し落ちるとき（DB が壊れている、設定が誤っているなど）は、起動し直しても直らないので諦める。
 * サーバーが「起動できない」と知らせたとき（ポートが使用中、二重起動）も、すぐに諦める
 */
export function createSupervisor(options: SupervisorOptions) {
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const windowMs = options.windowMs ?? DEFAULT_RESTART_WINDOW_MS;
  let current: ServerProcess | null = null;
  let stopping = false;
  let gaveUp = false;
  let fatalReason: string | null = null;
  const crashes: number[] = [];

  const giveUp = (reason: string) => {
    if (gaveUp) return;
    gaveUp = true;
    options.onGiveUp(reason);
  };

  /** 短い間に落ちた回数（今回を含む）。窓の外の古い記録は捨てる */
  const countRecentCrashes = (at: number): number => {
    crashes.push(at);
    while ((crashes[0] ?? at) <= at - windowMs) crashes.shift();
    return crashes.length;
  };

  const handleExit = (code: number) => {
    if (fatalReason !== null) {
      giveUp(fatalReason);
      return;
    }
    const count = countRecentCrashes(options.now());
    if (count > maxRestarts) {
      giveUp(
        `サーバーが ${Math.round(windowMs / 1000)} 秒の間に ${count} 回止まったため、起動し直すのをやめました（最後の終了コード ${code}）`,
      );
      return;
    }
    options.onRestart?.(code, count);
    launch();
  };

  const launch = () => {
    const child = options.start();
    current = child;
    child.onMessage((raw) => {
      const message = options.parseMessage(raw);
      if (message === null) return;
      if (message.type === 'ready') options.onReady(message.url);
      else fatalReason = message.reason;
    });
    child.onExit((code) => {
      if (current === child) current = null;
      if (!stopping) handleExit(code);
    });
  };

  return {
    start() {
      stopping = false;
      launch();
    },
    /** アプリの終了。起動し直さずにサーバーを止める */
    stop() {
      stopping = true;
      current?.kill();
    },
    /** 動いているか（テストと状態の表示のため） */
    isRunning: () => current !== null,
    hasGivenUp: () => gaveUp,
  };
}

export type Supervisor = ReturnType<typeof createSupervisor>;
