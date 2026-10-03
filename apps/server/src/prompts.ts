import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composePrompt, readPromptVersion } from '@mymind/agent';

const PROMPTS_DIR = fileURLToPath(new URL('../../../prompts/', import.meta.url));

/**
 * 日次 FB のプロンプトを読み、方針（coaching-policy.md）の本文を差し込む（FR-A11）。
 * バージョンはプロンプトの先頭の prompt_version（FB に記録して、新旧の出力を比べられるようにする）
 */
export function loadDailyPrompt(dir = PROMPTS_DIR): { text: string; version: string } {
  const template = readFileSync(`${dir}daily-feedback.md`, 'utf8');
  const policy = readFileSync(`${dir}coaching-policy.md`, 'utf8');
  return {
    text: composePrompt(template, policy),
    version: readPromptVersion(template) ?? 'unknown',
  };
}
