import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyFailure, describeFailure } from './errors';
import { agentEnv, firstLine, type RunProcess, runProcess, withEmptyWorkDir } from './process';
import type { AgentRunner, AgentRunResult } from './runner';
import { OUTPUT_JSON_SCHEMAS } from './schema';

/**
 * FB の生成で止める Codex の機能（ADR-0005、#10 の spike で確かめたもの。codex-cli 0.160.0）。
 * -s read-only は書き込みしか止めず、読み取りのコマンドは実行できる（spike ではホームディレクトリを検索した）。
 * そのため、コマンドの実行（shell_tool、unified_exec）と、外の世界に触れる機能を止める
 */
export const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'apps',
  'plugins',
  'image_generation',
  'multi_agent',
] as const;

/** spike で確かめた Codex の版。これと違う版では、止める機能の名前が変わっているかもしれない */
export const CODEX_TESTED_VERSION = '0.160.0';

const SCHEMA_FILE = 'output.schema.json';
const OUTPUT_FILE = 'last-message.txt';

/** codex exec の起動の引数（ADR-0005）。プロンプトは標準入力（-）で渡す */
export function codexArgs(options: { model?: string | undefined } = {}): string[] {
  return [
    'exec',
    '-',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ['-c', `features.${f}=false`]),
    '--output-schema',
    SCHEMA_FILE,
    '--output-last-message',
    OUTPUT_FILE,
    '--color',
    'never',
    // ChatGPT のアカウントでは使えないモデルがあり、設定ファイルで固定されていると失敗するので、指定できるようにする
    ...(options.model === undefined ? [] : ['-m', options.model]),
  ];
}

/** codex のログ（標準出力と標準エラー）から、最後のエラーの行を探す */
export function lastCodexError(log: string): string | null {
  const lines = log.split('\n').filter((l) => /^(\[[^\]]*\] )?ERROR:/.test(l.trim()));
  return lines.at(-1)?.trim() ?? null;
}

/** Codex のアダプタ（ADR-0003、ADR-0005） */
export function createCodexRunner(
  options: {
    command?: string;
    model?: string | undefined;
    run?: RunProcess;
    env?: NodeJS.ProcessEnv;
  } = {},
): AgentRunner {
  const { command = 'codex', run = runProcess, env = process.env } = options;
  return {
    name: 'codex',
    run: (input, { signal, kind }) =>
      withEmptyWorkDir(async (cwd): Promise<AgentRunResult> => {
        await writeFile(join(cwd, SCHEMA_FILE), JSON.stringify(OUTPUT_JSON_SCHEMAS[kind]));
        const result = await run(command, codexArgs({ model: options.model }), {
          stdin: input,
          cwd,
          env: agentEnv(env),
          signal,
        });
        if (result.aborted)
          return { ok: false, error: { kind: 'cancelled', message: '中断しました' } };
        if (result.notFound) {
          return {
            ok: false,
            error: {
              kind: 'failed',
              message: describeFailure('not_found', command),
            },
          };
        }
        const output = await readFile(join(cwd, OUTPUT_FILE), 'utf8').catch(() => '');
        // 古い版はエラーでも終了コードが 0 になるので、最後の返答が空かどうかでも失敗を見分ける
        if (result.exitCode !== 0 || output.trim() === '') {
          const reason =
            lastCodexError(`${result.stdout}\n${result.stderr}`) ?? firstLine(result.stderr) ?? '';
          return {
            ok: false,
            error: {
              kind: 'failed',
              message: describeFailure(
                classifyFailure(reason) === 'unknown' && result.exitCode !== 0
                  ? 'auth'
                  : classifyFailure(reason),
                `codex、終了コード ${result.exitCode}${reason === '' ? '' : `：${reason}`}`,
              ),
            },
          };
        }
        return { ok: true, output };
      }),
  };
}
