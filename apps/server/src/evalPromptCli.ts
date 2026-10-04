// 日次 FB（#22、FR-A11）と月次総括（#140、FR-A06）のプロンプトの評価。
// 実物のエージェントを呼ぶので CI では使わず、手で実行する（利用枠を使う）。
// 使い方：pnpm eval-prompt [claude|codex|all] [--kind daily|monthly] [--claude-model <名前>] [--codex-model <名前>]
// 結果は prompts/eval/outputs/<プロンプトのバージョン>/<エージェント>/<サンプル>.json に書き、PR に添付する
// （月次総括は prompts/eval/outputs/monthly-summary/<バージョン>/ の下に書く）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClaudeRunner, createCodexRunner } from '@mymind/agent';
import {
  type EvalResult,
  evaluateMonthlySample,
  evaluateSample,
  loadMonthlySamples,
  loadSamples,
} from './evalPrompt';
import { loadDailyPrompt, loadMonthlyPrompt } from './prompts';

const EVAL_DIR = fileURLToPath(new URL('../../../prompts/eval/', import.meta.url));
const TIMEOUT_MS = 120_000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'claude-model': { type: 'string' },
    'codex-model': { type: 'string' },
    kind: { type: 'string', default: 'daily' },
  },
});
const target = positionals[0] ?? 'all';
if (!['claude', 'codex', 'all'].includes(target)) {
  console.error('claude、codex、all のどれかを指定してください');
  process.exit(1);
}

const kind = values.kind;
if (kind !== 'daily' && kind !== 'monthly') {
  console.error('--kind には daily か monthly を指定してください');
  process.exit(1);
}
const isMonthly = kind === 'monthly';
const prompt = isMonthly ? loadMonthlyPrompt() : loadDailyPrompt();
const dailySamples = isMonthly ? [] : loadSamples(join(EVAL_DIR, 'samples'));
const monthlySamples = isMonthly ? loadMonthlySamples(join(EVAL_DIR, 'monthly-samples')) : [];
const outputRoot = isMonthly
  ? join(EVAL_DIR, 'outputs', 'monthly-summary', prompt.version)
  : join(EVAL_DIR, 'outputs', prompt.version);
const agents = [
  { name: 'claude', model: values['claude-model'] ?? null },
  { name: 'codex', model: values['codex-model'] ?? null },
].filter((a) => target === 'all' || a.name === target);

let failed = 0;
for (const agent of agents) {
  const model = agent.model ?? undefined;
  const runner =
    agent.name === 'claude' ? createClaudeRunner({ model }) : createCodexRunner({ model });
  const outDir = join(outputRoot, agent.name);
  mkdirSync(outDir, { recursive: true });
  const ctx = { prompt, runner, model: agent.model, now: () => Date.now(), timeoutMs: TIMEOUT_MS };
  const runs: { name: string; run: () => Promise<EvalResult> }[] = [
    ...dailySamples.map((sample) => ({
      name: sample.name,
      run: () => evaluateSample({ ...ctx, sample }),
    })),
    ...monthlySamples.map((sample) => ({
      name: sample.name,
      run: () => evaluateMonthlySample({ ...ctx, sample }),
    })),
  ];
  for (const { name, run } of runs) {
    const result = await run();
    writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) failed++;
    process.stdout.write(
      `${agent.name} ${name}: ${result.valid ? 'OK' : `NG（${result.error}）`} ${(result.durationMs / 1000).toFixed(1)}秒\n`,
    );
  }
}
process.stdout.write(`結果：${outputRoot}\n`);
process.exit(failed === 0 ? 0 : 1);
