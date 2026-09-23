import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN_FILE = 'session-token';
const LOCK_FILE = 'mymind.lock';

/** データディレクトリは本人だけが読めるようにする（ADR-0009） */
export function ensureDataDir(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  // 既にあったディレクトリには mode が効かないので、改めて設定する
  chmodSync(dataDir, 0o700);
}

/**
 * 起動ごとにセッショントークンを作り、パーミッション 600 で書き出す（ADR-0007）。
 * 開発時は Vite のプラグインがこのファイルを読んで画面に埋め込む。トークンを返す API は作らない。
 */
export function issueSessionToken(dataDir: string): string {
  const token = randomBytes(32).toString('base64url');
  const path = join(dataDir, TOKEN_FILE);
  writeFileSync(path, token, { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

export type LockError = { kind: 'already_running'; pid: number };

function isAlive(pid: number): boolean {
  try {
    // シグナル 0 は送らずに存在だけを確かめる
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM は別のユーザーのプロセスとして存在している
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockPid(path: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/**
 * 同じデータディレクトリを使うサーバーを1つに限る（NFR-20）。
 * ロックファイルのプロセスが生きていれば失敗を返し、異常終了で残ったロックは引き継ぐ。
 */
export function acquireLock(
  dataDir: string,
  pid: number,
): { ok: true; release: () => void } | { ok: false; error: LockError } {
  const path = join(dataDir, LOCK_FILE);
  // 同時に起動しても片方だけが作れるよう、存在しないときだけ作る（wx）
  for (;;) {
    try {
      writeFileSync(path, String(pid), { mode: 0o600, flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const holder = readLockPid(path);
    // 自分の PID が書かれているのは、以前のプロセスの PID が再利用された場合なので残骸として扱う
    if (holder !== undefined && holder !== pid && isAlive(holder)) {
      return { ok: false, error: { kind: 'already_running', pid: holder } };
    }
    // 異常終了で残ったロック。消して作り直す
    rmSync(path, { force: true });
  }
  return {
    ok: true,
    release: () => {
      // 別のプロセスに引き継がれていたら消さない
      if (readLockPid(path) === pid) rmSync(path, { force: true });
    },
  };
}
