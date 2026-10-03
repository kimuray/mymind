import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 子プロセスの結果。中断（キャンセル・タイムアウト）されたら aborted */
export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  aborted: boolean;
  /** 実行ファイルが見つからなかった */
  notFound: boolean;
};

export type RunProcess = (
  command: string,
  args: readonly string[],
  options: { stdin: string; cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal },
) => Promise<ProcessResult>;

/** 実物の子プロセス。標準入力に stdin を書き、終わるまで待つ。signal が中断されたら止める */
export const runProcess: RunProcess = (command, args, { stdin, cwd, env, signal }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let notFound = false;
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      // 中断の AbortError は close でまとめて扱う。見つからないときは close が来ないことがあるのでここで返す
      if (error.code === 'ENOENT') {
        notFound = true;
        resolve({ exitCode: null, stdout, stderr, aborted: false, notFound });
      }
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr, aborted: signal.aborted, notFound });
    });
    // 子が入力を読まずに終わっても、書き込みのエラーで落ちないようにする
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });

/**
 * 1回の実行のための空の作業ディレクトリ（ADR-0005）。
 * リポジトリの CLAUDE.md / AGENTS.md や設定を読ませないため、エージェントは空のディレクトリで起動する。
 * 終わったら中身ごと消す
 */
export async function withEmptyWorkDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'mymind-agent-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * エージェントに渡す環境変数。API キーを外し、ログインしたアカウント（プランの利用枠）で動かす（ADR-0005）。
 * API キーがあると、プランがあっても従量課金になるため
 */
export function agentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _a, OPENAI_API_KEY: _o, ...rest } = env;
  return rest;
}

/** 失敗の理由として画面に出す1行。長い出力は切り詰める */
export function firstLine(text: string, max = 200): string {
  const line = text.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line.trim();
}
