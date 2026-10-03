// 日次 FB のプロンプトの評価（#22、FR-A11）。実物のエージェントを呼ぶので CI では使わず、手で実行する（利用枠を使う）。
// 使い方：pnpm eval-prompt [claude|codex|all] [--claude-model <名前>] [--codex-model <名前>]
// 結果は prompts/eval/outputs/<プロンプトのバージョン>/<エージェント>/<サンプル>.json に書き、PR に添付する
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClaudeRunner, createCodexRunner } from '@mymind/agent';
import { evaluateSample, loadSamples } from './evalPrompt';
import { loadDailyPrompt } from './prompts';

const EVAL_DIR = fileURLToPath(new URL('../../../prompts/eval/', import.meta.url));
const TIMEOUT_MS = 120_000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'claude-model': { type: 'string' }, 'codex-model': { type: 'string' } },
});
const target = positionals[0] ?? 'all';
if (!['claude', 'codex', 'all'].includes(target)) {
  console.error('claude、codex、all のどれかを指定してください');
  process.exit(1);
}

const prompt = loadDailyPrompt();
const samples = loadSamples(join(EVAL_DIR, 'samples'));
const agents = [
  { name: 'claude', model: values['claude-model'] ?? null },
  { name: 'codex', model: values['codex-model'] ?? null },
].filter((a) => target === 'all' || a.name === target);

let failed = 0;
for (const agent of agents) {
  const model = agent.model ?? undefined;
  const runner =
    agent.name === 'claude' ? createClaudeRunner({ model }) : createCodexRunner({ model });
  const outDir = join(EVAL_DIR, 'outputs', prompt.version, agent.name);
  mkdirSync(outDir, { recursive: true });
  for (const sample of samples) {
    const result = await evaluateSample({
      sample,
      prompt,
      runner,
      model: agent.model,
      now: () => Date.now(),
      timeoutMs: TIMEOUT_MS,
    });
    writeFileSync(join(outDir, `${sample.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid) failed++;
    process.stdout.write(
      `${agent.name} ${sample.name}: ${result.valid ? 'OK' : `NG（${result.error}）`} ${(result.durationMs / 1000).toFixed(1)}秒\n`,
    );
  }
}
process.stdout.write(`結果：prompts/eval/outputs/${prompt.version}/\n`);
process.exit(failed === 0 ? 0 : 1);
