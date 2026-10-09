import { execFile, spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { RunGit, RunningUpdate } from './updater';

/**
 * 更新のための git と pnpm を、.app を作ったリポジトリで動かす（FR-U05、ADR-0017）。
 * apps/desktop で child_process を使うのはこのファイルだけ（.dependency-cruiser.cjs の例外）
 */

/**
 * git、pnpm、node がよく置かれる場所。Finder や Dock から開いたアプリの PATH は `/usr/bin:/bin:/usr/sbin:/sbin` だけなので足す
 * （ADR-0016 のエージェントの PATH と同じ理由）
 */
export const UPDATE_PATH_CANDIDATES = (home: string): string[] => [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(home, 'Library/pnpm'),
  join(home, '.local/share/pnpm'),
  join(home, '.local/share/mise/shims'),
  join(home, '.asdf/shims'),
  join(home, '.volta/bin'),
  join(home, '.local/bin'),
];

/** 今の PATH のあとに、よく使われる場所を重複を除いて足す（利用者が決めた順を崩さない） */
export function buildUpdatePath(current: string | undefined, home: string): string {
  const dirs = [...(current ?? '').split(delimiter), ...UPDATE_PATH_CANDIDATES(home)].filter(
    (d) => d !== '',
  );
  return [...new Set(dirs)].join(delimiter);
}

/** git と pnpm に渡す環境変数。入力を待って止まらないよう、パスワードやパスフレーズを尋ねさせない */
export function buildUpdateEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: buildUpdatePath(env['PATH'], home),
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: env['GIT_SSH_COMMAND'] ?? 'ssh -o BatchMode=yes',
  };
}

export function createGitRunner(input: { repoPath: string; env: NodeJS.ProcessEnv }): RunGit {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        'git',
        ['-C', input.repoPath, ...args],
        // 取得が遅いときも、いつまでも「確認しています」にしない
        { env: input.env, timeout: 60_000, encoding: 'utf8' },
        (error, stdout) => {
          if (error !== null) console.warn(`git ${args.join(' ')} に失敗しました`, error.message);
          resolve({
            code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
            stdout,
          });
        },
      );
    });
}

/**
 * `pnpm update-app` を動かし、出力をログのファイルに書く。スクリプトはこのアプリを終了させてから .app を入れ替えるので、
 * アプリが終わっても止まらないよう、別のプロセスグループで動かす
 */
export function startUpdateScript(input: {
  repoPath: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
}): RunningUpdate {
  const log = openSync(input.logPath, 'a');
  const child = spawn('pnpm', ['update-app'], {
    cwd: input.repoPath,
    env: input.env,
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  child.unref();
  let exited: number | null | undefined;
  const listeners: ((code: number | null) => void)[] = [];
  const finish = (code: number | null) => {
    if (exited !== undefined) return;
    exited = code;
    for (const listener of listeners) listener(code);
  };
  // pnpm が見つからないときは exit ではなく error になる
  child.on('error', (e) => {
    console.error('pnpm update-app を起動できませんでした', e);
    finish(null);
  });
  child.on('exit', (code) => finish(code));
  return {
    onExit: (listener) => {
      if (exited !== undefined) listener(exited);
      else listeners.push(listener);
    },
  };
}
