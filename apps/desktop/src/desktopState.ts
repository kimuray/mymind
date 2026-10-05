import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/** デスクトップアプリが覚えておく状態（userData の desktop-state.json） */
const desktopStateSchema = z.object({
  /** ログイン時の起動を、初回の起動で一度だけオンにしたか（利用者がオフにしたら、次の起動で戻さない） */
  loginItemInitialized: z.boolean().default(false),
});

export type DesktopState = z.infer<typeof desktopStateSchema>;

/** 状態を読む。ファイルがない、または読めないときは初期値（初めての起動として扱う） */
export function readDesktopState(path: string): DesktopState {
  try {
    const parsed = desktopStateSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : desktopStateSchema.parse({});
  } catch {
    // ファイルがない（初めての起動）、または壊れている。どちらも初期値から始める
    return desktopStateSchema.parse({});
  }
}

export function writeDesktopState(path: string, state: DesktopState): void {
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

/**
 * 初回の起動でログイン時の起動をオンにするか（NFR-27）。`.app` のときだけ扱う。
 * 開発時（electron .）にオンにすると、Electron の本体がログイン項目に登録されてしまうため
 */
export const shouldEnableLoginItemOnFirstRun = (input: {
  isPackaged: boolean;
  state: DesktopState;
}): boolean => input.isPackaged && !input.state.loginItemInitialized;
