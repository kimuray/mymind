import { z } from 'zod';

/**
 * デスクトップアプリ（apps/desktop）の子プロセスとして動いているときに、メインプロセスへ送る知らせ（ADR-0015）。
 * メインプロセスはこのスキーマで検証してから使う
 */
export const desktopMessageSchema = z.discriminatedUnion('type', [
  /** 待ち受けを始めた。ウィンドウはこの URL を開く */
  z.object({ type: z.literal('ready'), url: z.string() }),
  /** 起動できなかった（ポートが使用中、二重起動など）。起動し直しても直らないので、理由を利用者に見せる */
  z.object({ type: z.literal('fatal'), reason: z.string() }),
]);

export type DesktopMessage = z.infer<typeof desktopMessageSchema>;

type ParentPort = { postMessage: (message: DesktopMessage) => void };

/** Electron の utilityProcess で動いていれば、メインプロセスへの通信路を返す。普通の Node.js では null */
export function desktopParentPort(): ParentPort | null {
  const port: unknown = Reflect.get(process, 'parentPort');
  if (typeof port !== 'object' || port === null) return null;
  const postMessage: unknown = Reflect.get(port, 'postMessage');
  if (typeof postMessage !== 'function') return null;
  return { postMessage: (message) => postMessage.call(port, message) };
}
