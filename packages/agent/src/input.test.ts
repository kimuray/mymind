import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  budgetDaily,
  buildDailyFeedbackInput,
  DAILY_INPUT_MAX_CHARS,
  type DailyFeedbackData,
  type DailyStageInput,
  minimizeDaily,
  readPromptVersion,
  TRUNCATION_MARKER,
} from './input';
import type { Stage } from './pipeline';

const data: DailyFeedbackData = {
  day: '2026-09-23',
  tasks: [{ title: '企画書を書く', status: 'doing', parentTitle: 'Q4計画', statusDays: 3 }],
  counts: { planned: 1, done: 0, doing: 1, paused: 0, waiting: 0 },
  reflection: { thoughtsMd: '集中できた', learningMd: '朝に始めると続く' },
  recent: [{ day: '2026-09-22', level: 3, nextAction: '朝に見出しを書く', isBlank: false }],
};

/** 上限を超える日（長い振り返りと、直近7日の情報がある） */
const overLimit = JSON.parse(
  readFileSync(new URL('../fixtures/daily-input-over-limit.json', import.meta.url), 'utf8'),
) as DailyFeedbackData;

const dataJson = (text: string) =>
  text.slice(text.indexOf('<data>\n') + 7, text.lastIndexOf('\n</data>'));

describe('FR-A10 日次 FB の入力', () => {
  it('プロンプトのあとに、データを <data> で区切って渡す', () => {
    const { text } = buildDailyFeedbackInput('プロンプト', data);
    expect(text.startsWith('プロンプト\n\n<data>\n')).toBe(true);
    expect(text.trimEnd().endsWith('</data>')).toBe(true);
  });

  it('件数はコードで数えた値を stats としてそのまま渡す', () => {
    const { text, payload } = buildDailyFeedbackInput('プロンプト', data);
    expect(JSON.parse(dataJson(text))).toEqual(payload);
    expect(payload.stats).toEqual(data.counts);
  });

  it('プロンプトの先頭のコメントからバージョンを読む', () => {
    expect(readPromptVersion('<!-- prompt_version: 0.1.0 (draft) -->\n本文')).toBe('0.1.0');
    expect(readPromptVersion('本文だけ')).toBeNull();
  });
});

describe('NFR-15 入力の最小化', () => {
  it('タスクは名前、親の名前、状態、日数だけを送り、ID や時刻は送らない', () => {
    const { payload } = buildDailyFeedbackInput('プロンプト', overLimit);
    expect(payload.tasks[0]).toEqual({
      title: '企画書を書く',
      status: 'doing',
      parent: 'Q4計画',
      days: 3,
    });
    expect(payload.tasks[1]).toEqual({ title: 'レビューの指摘を直す', status: 'done', days: 1 });
    expect(JSON.stringify(payload)).not.toMatch(/01J0|createdAt/);
  });

  it('直近の日は、調子と明日の一手と空白日かどうかだけを、新しい順に最大7日送る', () => {
    const recent = Array.from({ length: 9 }, (_, i) => ({
      day: `2026-09-${String(10 + i).padStart(2, '0')}`,
      level: 2,
      nextAction: null,
      isBlank: false,
      reflection: '全文は送らない',
    }));
    const { payload } = buildDailyFeedbackInput('プロンプト', { ...data, recent });
    expect(payload.recent.map((r) => r.day)).toEqual([
      '2026-09-18',
      '2026-09-17',
      '2026-09-16',
      '2026-09-15',
      '2026-09-14',
      '2026-09-13',
      '2026-09-12',
    ]);
    expect(payload.recent[0]).toEqual({
      day: '2026-09-18',
      condition: 2,
      next_action: null,
      blank: false,
    });
  });

  it('振り返りがまだなければ reflection を入れない', () => {
    const { payload } = buildDailyFeedbackInput('プロンプト', { ...data, reflection: null });
    expect(payload).not.toHaveProperty('reflection');
  });
});

describe('NFR-15 入力の量の上限', () => {
  it('上限に収まるなら、加工せず注記もない', () => {
    const result = buildDailyFeedbackInput('プロンプト', data);
    expect(result.annotations).toEqual([]);
    expect(result.payload.reflection).toEqual({
      thoughts_md: '集中できた',
      learning_md: '朝に始めると続く',
    });
  });

  it('上限を超えたら、12,000文字以内に収める', () => {
    const result = buildDailyFeedbackInput('プロンプト', overLimit);
    expect(result.charCount).toBeLessThanOrEqual(DAILY_INPUT_MAX_CHARS);
    expect(dataJson(result.text)).toHaveLength(result.charCount);
  });

  it('先に古い日の情報から省き、省いた日を注記に残す', () => {
    const result = buildDailyFeedbackInput('プロンプト', overLimit);
    const omitted = result.annotations.filter((a) => a.kind === 'omitted');
    expect(omitted.map((a) => a.path)).toEqual([
      'recent.2026-09-18',
      'recent.2026-09-19',
      'recent.2026-09-20',
      'recent.2026-09-21',
      'recent.2026-09-22',
      'recent.2026-09-23',
      'recent.2026-09-24',
    ]);
    expect(result.payload.recent).toEqual([]);
  });

  it('それでも超えたら振り返りの末尾を切り詰め、入力の中にも切り詰めたことを書く', () => {
    const result = buildDailyFeedbackInput('プロンプト', overLimit);
    const learning = result.payload.reflection?.learning_md ?? '';
    expect(learning.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(
      overLimit.reflection?.learningMd.startsWith(learning.slice(0, -TRUNCATION_MARKER.length)),
    ).toBe(true);
    expect(result.annotations).toContainEqual({
      kind: 'truncated',
      path: 'reflection.learning_md',
      reason: '上限の12,000文字を超えたため末尾を切り詰めました',
    });
    expect(result.text).toContain(TRUNCATION_MARKER);
  });

  it('学びだけで足りなければ、考えの末尾も切り詰める', () => {
    const result = buildDailyFeedbackInput('プロンプト', overLimit, { maxChars: 3_000 });
    expect(result.charCount).toBeLessThanOrEqual(3_000);
    expect(result.payload.reflection?.learning_md).toBe(TRUNCATION_MARKER);
    expect(result.payload.reflection?.thoughts_md.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(result.annotations.map((a) => a.path)).toContain('reflection.thoughts_md');
  });
});

describe('NFR-15 送信前処理の段階', () => {
  it('何もしない段階を budget の前に足しても、入力と注記は変わらない', () => {
    const noop: Stage<DailyStageInput> = {
      id: 'noop',
      apply: (input) => ({ input, annotations: [] }),
    };
    const standard = buildDailyFeedbackInput('プロンプト', overLimit);
    const extended = buildDailyFeedbackInput('プロンプト', overLimit, {
      stages: [minimizeDaily, noop, budgetDaily],
    });
    expect(extended).toEqual(standard);
  });

  it('段階の注記は、段階の順に集まる', () => {
    const excludeFirstTask: Stage<DailyStageInput> = {
      id: 'exclude-example',
      apply: (input) =>
        'stats' in input
          ? {
              input: { ...input, tasks: input.tasks.slice(1) },
              annotations: [{ kind: 'omitted', path: 'tasks.0', reason: '例：除外した' }],
            }
          : { input, annotations: [] },
    };
    const result = buildDailyFeedbackInput('プロンプト', overLimit, {
      stages: [minimizeDaily, excludeFirstTask, budgetDaily],
    });
    expect(result.annotations[0]).toEqual({
      kind: 'omitted',
      path: 'tasks.0',
      reason: '例：除外した',
    });
    expect(result.payload.tasks.map((t) => t.title)).toEqual(['レビューの指摘を直す']);
  });

  it('minimize を通さないと入力を作らない（プログラムの誤り）', () => {
    expect(() => buildDailyFeedbackInput('プロンプト', data, { stages: [budgetDaily] })).toThrow(
      /minimize/,
    );
  });
});

describe('FR-A12 送る入力のハッシュ', () => {
  it('同じデータからは同じハッシュになり、sha256: で始まる', () => {
    const a = buildDailyFeedbackInput('プロンプト', data);
    const b = buildDailyFeedbackInput('プロンプト', structuredClone(data));
    expect(a.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(b.payloadHash).toBe(a.payloadHash);
  });

  it('送る内容が1文字でも変わるとハッシュが変わる', () => {
    const changed = { ...data, tasks: [{ ...data.tasks[0], title: '企画書を書いた' }] };
    expect(
      buildDailyFeedbackInput('プロンプト', changed as DailyFeedbackData).payloadHash,
    ).not.toBe(buildDailyFeedbackInput('プロンプト', data).payloadHash);
  });

  it('送らない項目（ID など）が変わってもハッシュは変わらない', () => {
    const withId = { ...data, tasks: data.tasks.map((t) => ({ ...t, id: 'task-1' })) };
    expect(buildDailyFeedbackInput('プロンプト', withId).payloadHash).toBe(
      buildDailyFeedbackInput('プロンプト', data).payloadHash,
    );
  });

  it('プロンプトが変わってもハッシュは変わらない（利用者が確認するのは送るデータ）', () => {
    expect(buildDailyFeedbackInput('別のプロンプト', data).payloadHash).toBe(
      buildDailyFeedbackInput('プロンプト', data).payloadHash,
    );
  });
});
