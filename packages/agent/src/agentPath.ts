import { execFile } from 'node:child_process';
import { delimiter, join } from 'node:path';

/**
 * エージェントの CLI がよく置かれる場所（ADR-0016）。Finder や Dock から開いたアプリの PATH は
 * `/usr/bin:/bin:/usr/sbin:/sbin` だけで、ログインシェルの PATH にも、ターミナルのシェルの設定でだけ足した場所は入らない
 */
export const AGENT_PATH_CANDIDATES = (home: string): string[] => [
  join(home, '.local/bin'),
  join(home, '.asdf/shims'),
  join(home, '.volta/bin'),
  join(home, '.npm-global/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

/**
 * エージェントを起動するための PATH を作る。今の PATH、ログインシェルの PATH、よく使われる場所の順に、重複を除いてつなぐ。
 * 先に書いた場所が優先される（利用者がシェルで決めた順を崩さない）
 */
export function buildAgentPath(input: {
  current: string | undefined;
  loginShell: string | null;
  home: string;
}): string {
  const dirs = [
    ...(input.current ?? '').split(delimiter),
    ...(input.loginShell ?? '').split(delimiter),
    ...AGENT_PATH_CANDIDATES(input.home),
  ].filter((d) => d !== '');
  return [...new Set(dirs)].join(delimiter);
}

/**
 * ログインシェルの PATH を読む（`$SHELL -ilc`）。読めなければ null（シェルの設定が壊れていても起動を止めない）。
 * シェルの設定が何かを表示しても混ざらないよう、印で挟んで取り出す
 */
export function readLoginShellPath(
  shell: string | undefined,
  timeoutMs = 5000,
): Promise<string | null> {
  if (shell === undefined || shell === '') return Promise.resolve(null);
  const mark = '__MYMIND_PATH__';
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '${mark}%s${mark}' "$PATH"`],
      { timeout: timeoutMs, encoding: 'utf8' },
      (error, stdout) => {
        if (error !== null) {
          resolve(null);
          return;
        }
        resolve(parseMarkedPath(stdout, mark));
      },
    );
  });
}

/** 印で挟んだ PATH を取り出す。見つからなければ null */
export function parseMarkedPath(output: string, mark = '__MYMIND_PATH__'): string | null {
  const start = output.indexOf(mark);
  const end = output.indexOf(mark, start + mark.length);
  if (start === -1 || end === -1) return null;
  const path = output.slice(start + mark.length, end).trim();
  return path === '' ? null : path;
}
