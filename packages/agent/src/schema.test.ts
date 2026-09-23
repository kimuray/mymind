import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDailyFeedback } from './schema';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

describe('FR-A02 日次FBの出力検証', () => {
  it('正しい形式の出力を受け付ける', () => {
    const result = parseDailyFeedback(fixture('daily-valid.json'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.condition.level).toBe(2);
  });

  it('コードブロックで囲まれた出力からJSONを取り出せる', () => {
    const result = parseDailyFeedback(fixture('daily-fenced.txt'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.next_action).toContain('EM');
  });

  it('調子が0〜4の範囲外なら拒否する', () => {
    const result = parseDailyFeedback(fixture('daily-level-out-of-range.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('condition.level');
  });

  it('定義にない項目を含む出力は拒否する（FR-A10：数値はAIに出させない）', () => {
    expect(parseDailyFeedback(fixture('daily-extra-field.json')).ok).toBe(false);
  });

  it('JSONを含まない出力は拒否する', () => {
    expect(parseDailyFeedback('すみません、うまく生成できませんでした。')).toEqual({
      ok: false,
      error: 'JSON が見つかりません',
    });
  });

  it('壊れたJSONは拒否する', () => {
    expect(parseDailyFeedback('{"condition": {').ok).toBe(false);
  });
});
