import type { JobKind } from '@mymind/domain';
import { z } from 'zod';
import { classifyFailure, describeFailure } from './errors';
import { agentEnv, firstLine, type RunProcess, runProcess, withEmptyWorkDir } from './process';
import type { AgentRunner, AgentRunResult } from './runner';
import { OUTPUT_JSON_SCHEMAS } from './schema';

/**
 * claude -p の起動の引数（ADR-0005、#10 の spike で確かめたもの）。
 * - --tools ""：ツールをすべて無効にする（ファイルの読み書きもコマンドの実行もさせない）
 * - --setting-sources "" と --strict-mcp-config：設定ファイル（とその中のフック）と MCP サーバーを読まない
 * - --bare は使わない：ログイン（OAuth）を読まず API キーだけで動くため、プランの利用枠で使えない
 */
export function claudeArgs(options: { model?: string | undefined; kind: JobKind }): string[] {
  return [
    '-p',
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(OUTPUT_JSON_SCHEMAS[options.kind]),
    ...(options.model === undefined ? [] : ['--model', options.model]),
  ];
}

/** --output-format json の結果。FB は structured_output（構造化出力）か result（文字列）に入る */
const claudeResultSchema = z.object({
  is_error: z.boolean(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
});

/**
 * claude -p の出力から、検証に渡す文字列を取り出す。
 * 構造化出力を優先する（文字列の result には「作成しました」のような前置きが混ざることがあるため）
 */
export function readClaudeOutput(
  stdout: string,
): { ok: true; output: string } | { ok: false; message: string } {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { ok: false, message: `claude の出力を読めませんでした：${firstLine(stdout)}` };
  }
  const parsed = claudeResultSchema.safeParse(json);
  if (!parsed.success) return { ok: false, message: 'claude の出力の形が想定と違います' };
  const r = parsed.data;
  if (r.is_error) {
    const reason = firstLine(r.result ?? r.subtype ?? '');
    return { ok: false, message: describeFailure(classifyFailure(reason), `claude：${reason}`) };
  }
  if (r.structured_output !== undefined)
    return { ok: true, output: JSON.stringify(r.structured_output) };
  if (r.result !== undefined) return { ok: true, output: r.result };
  return { ok: false, message: 'claude の出力に FB がありませんでした' };
}

/** Claude Code のアダプタ（ADR-0003、ADR-0005） */
export function createClaudeRunner(
  options: {
    command?: string;
    model?: string | undefined;
    run?: RunProcess;
    env?: NodeJS.ProcessEnv;
  } = {},
): AgentRunner {
  const { command = 'claude', run = runProcess, env = process.env } = options;
  return {
    name: 'claude',
    run: (input, { signal, kind }) =>
      withEmptyWorkDir(async (cwd): Promise<AgentRunResult> => {
        const result = await run(command, claudeArgs({ model: options.model, kind }), {
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
        const read = readClaudeOutput(result.stdout);
        if (result.exitCode !== 0 && !read.ok) {
          // ログインしていないなどの失敗。理由が分かるよう、標準エラーか出力の最初の行を添える
          const reason = firstLine(result.stderr) || read.message;
          return {
            ok: false,
            error: {
              kind: 'failed',
              // 種類が分からない失敗は、ログインしていないものとして扱う（未ログインの出力は確かめられていない、#10）
              message: describeFailure(
                classifyFailure(reason) === 'unknown' ? 'auth' : classifyFailure(reason),
                `claude、終了コード ${result.exitCode}：${reason}`,
              ),
            },
          };
        }
        return read.ok
          ? { ok: true, output: read.output }
          : { ok: false, error: { kind: 'failed', message: read.message } };
      }),
  };
}
