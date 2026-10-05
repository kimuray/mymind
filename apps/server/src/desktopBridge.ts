import { z } from 'zod';

/** 通知の中身（domain の Notification と同じ形）。メインプロセスは画面へ移るために path を使う */
const notificationSchema = z.object({
  kind: z.enum(['morning', 'evening', 'inventory']),
  title: z.string(),
  body: z.string(),
  path: z.string().startsWith('/'),
});

/**
 * デスクトップアプリ（apps/desktop）の子プロセスとして動いているときに、メインプロセスへ送る知らせ（ADR-0015）。
 * メインプロセスはこのスキーマで検証してから使う
 */
export const desktopMessageSchema = z.discriminatedUnion('type', [
  /** 待ち受けを始めた。ウィンドウはこの URL を開く */
  z.object({ type: z.literal('ready'), url: z.string() }),
  /** 起動できなかった（ポートが使用中、二重起動など）。起動し直しても直らないので、理由を利用者に見せる */
  z.object({ type: z.literal('fatal'), reason: z.string() }),
  /** OS の通知を出してほしい（FR-N05）。結果は同じ id の notify-result で返してもらう */
  z.object({ type: z.literal('notify'), id: z.number().int(), notification: notificationSchema }),
]);

export type DesktopMessage = z.infer<typeof desktopMessageSchema>;

/** メインプロセスからサーバーへの返事 */
export const desktopReplySchema = z.object({
  type: z.literal('notify-result'),
  id: z.number().int(),
  ok: z.boolean(),
  message: z.string().optional(),
});

export type DesktopReply = z.infer<typeof desktopReplySchema>;

export type ParentPort = {
  postMessage: (message: DesktopMessage) => void;
  /** メインプロセスからの返事を受け取る（検証前） */
  onMessage: (listener: (message: unknown) => void) => void;
};

/** Electron の utilityProcess で動いていれば、メインプロセスとの通信路を返す。普通の Node.js では null */
export function desktopParentPort(): ParentPort | null {
  const port: unknown = Reflect.get(process, 'parentPort');
  if (typeof port !== 'object' || port === null) return null;
  const postMessage: unknown = Reflect.get(port, 'postMessage');
  const on: unknown = Reflect.get(port, 'on');
  if (typeof postMessage !== 'function' || typeof on !== 'function') return null;
  return {
    postMessage: (message) => postMessage.call(port, message),
    // utilityProcess の parentPort は、届いた値を event.data に入れて渡す
    onMessage: (listener) =>
      on.call(port, 'message', (event: unknown) =>
        listener(typeof event === 'object' && event !== null ? Reflect.get(event, 'data') : event),
      ),
  };
}

/** 返事を待つ時間。OS の通知は出すだけなので、これを過ぎたら出せなかったものとして次の手段に回す */
export const NOTIFY_TIMEOUT_MS = 10_000;

/**
 * メインプロセスに OS の通知を頼む（FR-N05）。返事を id で対応づけ、来なければ出せなかったことにする
 */
export function createDesktopNotifier(
  port: ParentPort,
  options: { timeoutMs?: number; setTimer?: (fn: () => void, ms: number) => () => void } = {},
) {
  const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS;
  const setTimer =
    options.setTimer ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
  const waiting = new Map<number, (reply: { ok: true } | { ok: false; message: string }) => void>();
  let nextId = 1;
  port.onMessage((raw) => {
    const reply = desktopReplySchema.safeParse(raw);
    if (!reply.success) return;
    waiting.get(reply.data.id)?.(
      reply.data.ok
        ? { ok: true }
        : { ok: false, message: reply.data.message ?? '通知を出せませんでした' },
    );
  });
  return {
    notify(
      notification: z.infer<typeof notificationSchema>,
    ): Promise<{ ok: true } | { ok: false; message: string }> {
      const id = nextId++;
      return new Promise((resolve) => {
        const cancel = setTimer(() => {
          waiting.delete(id);
          resolve({ ok: false, message: 'デスクトップアプリから返事がありませんでした' });
        }, timeoutMs);
        waiting.set(id, (reply) => {
          cancel();
          waiting.delete(id);
          resolve(reply);
        });
        port.postMessage({ type: 'notify', id, notification });
      });
    },
  };
}
