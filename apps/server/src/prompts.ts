import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composePrompt, readPromptVersion } from '@mymind/agent';

const PROMPTS_DIR = fileURLToPath(new URL('../../../prompts/', import.meta.url));

export type LoadedPrompt = { text: string; version: string };

/**
 * プロンプトを読み、方針（coaching-policy.md）の本文を差し込む（FR-A11）。
 * バージョンはプロンプトの先頭の prompt_version（FB に記録して、新旧の出力を比べられるようにする）
 */
function loadPrompt(file: string, dir: string): LoadedPrompt {
  const template = readFileSync(`${dir}${file}`, 'utf8');
  const policy = readFileSync(`${dir}coaching-policy.md`, 'utf8');
  return {
    text: composePrompt(template, policy),
    version: readPromptVersion(template) ?? 'unknown',
  };
}

/** 日次 FB のプロンプト（prompts/daily-feedback.md） */
export const loadDailyPrompt = (dir = PROMPTS_DIR) => loadPrompt('daily-feedback.md', dir);

/** 月次総括のプロンプト（prompts/monthly-summary.md、FR-A06） */
export const loadMonthlyPrompt = (dir = PROMPTS_DIR) => loadPrompt('monthly-summary.md', dir);
