import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/** デスクトップアプリが覚えておく状態（userData の desktop-state.json） */
const desktopStateSchema = z.object({
  /** ログイン時の起動を、初回の起動で一度だけオンにしたか（利用者がオフにしたら、次の起動で戻さない） */
  loginItemInitialized: z.boolean().default(false),
});

export type DesktopState = z.infer<typeof desktopStateSchema>;

/**
 * 状態を読む。ファイルがなければ初めての起動（missing）。読めない・形が違うとき（invalid）は、
 * 利用者がオフにしたログイン時の起動をオンに戻さないよう、初めての起動としては扱わない
 */
export function readDesktopState(
  path: string,
): { kind: 'ok'; state: DesktopState } | { kind: 'missing' } | { kind: 'invalid'; reason: string } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'invalid', reason: e instanceof Error ? e.message : String(e) };
  }
  try {
    const parsed = desktopStateSchema.safeParse(JSON.parse(text));
    return parsed.success
      ? { kind: 'ok', state: parsed.data }
      : { kind: 'invalid', reason: '形が正しくありません' };
  } catch (e) {
    return { kind: 'invalid', reason: e instanceof Error ? e.message : String(e) };
  }
}

export function writeDesktopState(path: string, state: DesktopState): void {
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

/**
 * 初回の起動でログイン時の起動をオンにするか（NFR-27）。`.app` で、状態のファイルがまだないときだけ。
 * 開発時（electron .）にオンにすると、Electron の本体がログイン項目に登録されてしまうため扱わない。
 * 状態のファイルが読めないときは、オフにした設定を戻してしまわないよう、何もしない
 */
export const shouldEnableLoginItemOnFirstRun = (input: {
  isPackaged: boolean;
  read: ReturnType<typeof readDesktopState>;
}): boolean =>
  input.isPackaged &&
  (input.read.kind === 'missing' ||
    (input.read.kind === 'ok' && !input.read.state.loginItemInitialized));
