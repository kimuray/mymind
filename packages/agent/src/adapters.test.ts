import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeArgs, createClaudeRunner, readClaudeOutput } from './claude';
import { CODEX_DISABLED_FEATURES, codexArgs, createCodexRunner, lastCodexError } from './codex';
import { classifyFailure, describeFailure } from './errors';
import { placeData } from './input';
import type { ProcessResult, RunProcess } from './process';
import { dailyFeedbackJsonSchema, monthlySummaryJsonSchema, parseDailyFeedback } from './schema';

// 実物のエージェントは呼ばない（testing.md）。#10 の spike で得た実際の出力を fixture にして、子プロセスを差し替える
const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

type Call = {
  command: string;
  args: readonly string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

/** 子プロセスの代わり。呼ばれ方を記録し、決めた結果を返す。onRun で作業ディレクトリにファイルを置ける */
function fakeProcess(
  result: Partial<ProcessResult>,
  onRun: (cwd: string) => void = () => {},
): { run: RunProcess; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    run: async (command, args, { stdin, cwd, env }) => {
      calls.push({ command, args, stdin, cwd, env });
      onRun(cwd);
      return { exitCode: 0, stdout: '', stderr: '', aborted: false, notFound: false, ...result };
    },
  };
}

const signal = () => new AbortController().signal;
const env = {
  PATH: '/usr/bin',
  ANTHROPIC_API_KEY: 'sk-ant',
  OPENAI_API_KEY: 'sk-openai',
  HOME: '/h',
};

describe('FR-A01 Claude Code のアダプタ', () => {
  it('ツール・設定・MCP を止め、構造化出力のスキーマを付けて起動する（--bare は使わない）', () => {
    const args = claudeArgs({ model: 'sonnet', kind: 'daily_feedback' });
    expect(args).toEqual(
      expect.arrayContaining(['-p', '--strict-mcp-config', '--output-format', 'json']),
    );
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] ?? '')).toEqual(
      dailyFeedbackJsonSchema,
    );
    expect(args.slice(-2)).toEqual(['--model', 'sonnet']);
    expect(args).not.toContain('--bare');
  });

  it('実際の出力から構造化出力を取り出し、検証を通る', async () => {
    const { run, calls } = fakeProcess({ stdout: fixture('claude-success.json') });
    const result = await createClaudeRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(parseDailyFeedback(result.output).ok).toBe(true);
    expect(calls[0]?.stdin).toBe('入力');
  });

  it('API キーを渡さず、空の作業ディレクトリで動かし、終わったら消す', async () => {
    const { run, calls } = fakeProcess({ stdout: fixture('claude-success.json') });
    await createClaudeRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(calls[0]?.env).toEqual({ PATH: '/usr/bin', HOME: '/h' });
    expect(calls[0]?.cwd).toMatch(/mymind-agent-/);
    expect(existsSync(calls[0]?.cwd ?? '')).toBe(false);
  });

  it('構造化出力がなければ、前置きの混ざった文字列からも検証できる形で返す', () => {
    const read = readClaudeOutput(fixture('claude-unstructured.json'));
    expect(read.ok).toBe(true);
    if (read.ok) expect(parseDailyFeedback(read.output).ok).toBe(true);
  });

  it('終了コードが 0 でなければ、理由とログインの確認を促して失敗にする', async () => {
    const { run } = fakeProcess({
      exitCode: 1,
      stdout: '',
      stderr: 'Invalid API key · Please run /login\n',
    });
    const result = await createClaudeRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'failed',
        message:
          'エージェントにログインしていないようです。ターミナルでログインしてから、もう一度依頼してください（claude、終了コード 1：Invalid API key · Please run /login）',
      },
    });
  });

  it('is_error の結果は失敗にする', async () => {
    const stdout = JSON.stringify({
      is_error: true,
      subtype: 'error_during_execution',
      result: '上限に達しました',
    });
    const { run } = fakeProcess({ stdout });
    const result = await createClaudeRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'failed',
        message:
          'エージェントの利用上限に達したようです。しばらく待ってから、もう一度依頼してください（claude：上限に達しました）',
      },
    });
  });

  it('中断されたらキャンセル、実行ファイルがなければ PATH の確認を促す', async () => {
    const aborted = await createClaudeRunner({ run: fakeProcess({ aborted: true }).run, env }).run(
      '入力',
      { signal: signal(), kind: 'daily_feedback' },
    );
    expect(aborted).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
    const missing = await createClaudeRunner({ run: fakeProcess({ notFound: true }).run, env }).run(
      '入力',
      { signal: signal(), kind: 'daily_feedback' },
    );
    expect(missing).toMatchObject({
      ok: false,
      error: {
        message:
          'エージェントのコマンドが見つかりません。インストールされているか、PATH を確かめてください（claude）',
      },
    });
  });
});

describe('FR-A01 Codex のアダプタ', () => {
  it('読み取り専用にし、コマンドの実行と外に触れる機能を止め、出力のスキーマと最後の返答のファイルを指定する', () => {
    const args = codexArgs({ model: 'gpt-5.6-terra' });
    expect(args.slice(0, 2)).toEqual(['exec', '-']);
    expect(args[args.indexOf('-s') + 1]).toBe('read-only');
    for (const feature of ['shell_tool', 'unified_exec']) {
      expect(args).toContain(`features.${feature}=false`);
    }
    expect(args.filter((a) => a === '-c')).toHaveLength(CODEX_DISABLED_FEATURES.length);
    expect(args.slice(-2)).toEqual(['-m', 'gpt-5.6-terra']);
  });

  it('作業ディレクトリにスキーマを置き、最後の返答のファイルを読んで返す', async () => {
    let schema = '';
    const { run, calls } = fakeProcess({ stdout: 'codex のログ' }, (cwd) => {
      schema = readFileSync(join(cwd, 'output.schema.json'), 'utf8');
      writeFileSync(join(cwd, 'last-message.txt'), fixture('codex-success.txt'));
    });
    const result = await createCodexRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(JSON.parse(schema)).toEqual(dailyFeedbackJsonSchema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(parseDailyFeedback(result.output).ok).toBe(true);
    expect(calls[0]?.env).toEqual({ PATH: '/usr/bin', HOME: '/h' });
  });

  it('モデルのエラーでは、ログの最後のエラーの行を理由にして失敗にする', async () => {
    const { run } = fakeProcess({ exitCode: 1, stderr: fixture('codex-model-error.txt') });
    const result = await createCodexRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'failed' } });
    if (!result.ok) {
      expect(result.error.message).toContain('終了コード 1');
      expect(result.error.message).toContain(
        'not supported when using Codex with a ChatGPT account',
      );
    }
  });

  it('古い版のように終了コードが 0 でも、最後の返答が空なら失敗にする', async () => {
    const { run } = fakeProcess({ exitCode: 0 }, (cwd) =>
      writeFileSync(join(cwd, 'last-message.txt'), ''),
    );
    const result = await createCodexRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(result).toMatchObject({ ok: false, error: { kind: 'failed' } });
  });

  it('ログからは、最後のエラーの行を取り出す', () => {
    expect(lastCodexError('a\n[2026-10-03T21:54:56] ERROR: 1つ目\nb\nERROR: 2つ目\n')).toBe(
      'ERROR: 2つ目',
    );
    expect(lastCodexError('エラーなし')).toBeNull();
  });
});

describe('FR-A06 月次総括の出力の形', () => {
  it('Claude Code には、月次総括のスキーマを構造化出力に指定する', () => {
    const args = claudeArgs({ kind: 'monthly_summary' });
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] ?? '')).toEqual(
      monthlySummaryJsonSchema,
    );
  });

  it('Codex には、月次総括のスキーマを作業ディレクトリに置く', async () => {
    let schema = '';
    const { run } = fakeProcess({}, (cwd) => {
      schema = readFileSync(join(cwd, 'output.schema.json'), 'utf8');
      writeFileSync(join(cwd, 'last-message.txt'), '{}');
    });
    await createCodexRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'monthly_summary',
    });
    expect(JSON.parse(schema)).toEqual(monthlySummaryJsonSchema);
  });
});

describe('FR-A01 エージェントに渡す入力', () => {
  it('プロンプトの置き場所に入力の JSON を入れ、<data> を2つにしない', () => {
    const text = placeData('前文\n<data>\n{{input_json}}\n</data>\n後文', '{"a":"$&"}');
    expect(text).toBe('前文\n<data>\n{"a":"$&"}\n</data>\n後文\n');
  });

  it('置き場所がないプロンプトなら、末尾に <data> を付ける', () => {
    expect(placeData('前文', '{}')).toBe('前文\n\n<data>\n{}\n</data>\n');
  });

  it('構造化出力のスキーマは "$schema" を持たない（Claude Code が解釈できないため）', () => {
    expect(dailyFeedbackJsonSchema).not.toHaveProperty('$schema');
    expect(dailyFeedbackJsonSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });
});

describe('FR-A08 エージェントの失敗の種類（#23）', () => {
  it.each([
    ['Error: You have hit your usage limit. Try again later.', 'rate_limit'],
    ['429 Too Many Requests', 'rate_limit'],
    ['利用上限に達しました', 'rate_limit'],
    ["The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account.", 'model'],
    ['Invalid API key · Please run /login', 'auth'],
    ['401 Unauthorized', 'auth'],
    ['something unexpected', 'unknown'],
  ] as const)('「%s」は %s', (reason, kind) => {
    expect(classifyFailure(reason)).toBe(kind);
  });

  it('種類ごとに対処を書き、CLI の理由を添える', () => {
    expect(describeFailure('timeout', '120秒で中止しました')).toBe(
      '時間内に応答がありませんでした。もう一度依頼するか、MYMIND_AGENT_TIMEOUT_SEC を長くしてください（120秒で中止しました）',
    );
    expect(describeFailure('unknown')).toBe('エージェントが FB を返しませんでした');
  });

  it('Codex のモデルのエラーは、モデルを確かめるよう促す', async () => {
    const { run } = fakeProcess({ exitCode: 1, stderr: fixture('codex-model-error.txt') });
    const result = await createCodexRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/^指定したモデルが使えないようです/);
  });

  it('種類の分からない失敗で終了コードが 0 以外なら、ログインしていないものとして扱う', async () => {
    const { run } = fakeProcess({ exitCode: 2, stderr: 'boom' });
    const result = await createCodexRunner({ run, env }).run('入力', {
      signal: signal(),
      kind: 'daily_feedback',
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toMatch(/^エージェントにログインしていないようです/);
  });
});
