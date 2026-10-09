import { describe, expect, it } from 'vitest';
import {
  buildMonthlySummaryInput,
  type MonthlySummaryData,
  REFLECTION_HEAD_CHARS,
  TRUNCATION_MARKER,
} from './input';

const day = (
  d: string,
  extra: Partial<MonthlySummaryData['days'][number]> = {},
): MonthlySummaryData['days'][number] => ({
  day: d,
  isBlank: false,
  condition: null,
  feedback: null,
  reflection: null,
  ...extra,
});

const data: MonthlySummaryData = {
  month: '2026-09',
  isPartial: true,
  through: '2026-09-23',
  stats: {
    recordedDays: 2,
    blankDays: 1,
    feedbackDays: 1,
    correctedDays: 1,
    completed: 4,
    byTag: [
      { tag: '仕事', completed: 3, doingDays: 5, waitingDays: 1 },
      { tag: null, completed: 1, doingDays: 1, waitingDays: 0 },
    ],
  },
  days: [
    day('2026-09-02', {
      condition: { ai: 3, user: 2 },
      feedback: { good: ['朝に設計した'], insight: ['午後に止まる'], nextAction: '週報は朝に書く' },
      reflection: { thoughtsMd: 'FB がある日の振り返りの全文', learningMd: '' },
    }),
    day('2026-09-01', {
      reflection: { thoughtsMd: '集中できた', learningMd: '朝に始めると続く' },
    }),
    day('2026-09-03', { isBlank: true }),
  ],
};

const dataJson = (text: string) =>
  JSON.parse(text.slice(text.indexOf('<data>\n') + 7, text.lastIndexOf('\n</data>')));

describe('FR-A06 NFR-15 月次総括の入力', () => {
  it('コードで数えた集計と途中経過かどうかを、そのまま渡す', () => {
    const { payload, text } = buildMonthlySummaryInput('プロンプト', data);
    expect(dataJson(text)).toEqual(payload);
    expect(payload).toMatchObject({
      month: '2026-09',
      partial: true,
      through: '2026-09-23',
      stats: {
        recorded_days: 2,
        blank_days: 1,
        feedback_days: 1,
        corrected_days: 1,
        completed: 4,
      },
    });
  });

  it('日を古い順に並べ、日次 FB の要点と、AI の判定と手で直した調子を渡す', () => {
    const { payload } = buildMonthlySummaryInput('プロンプト', data);
    expect(payload.days.map((d) => d.day)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(payload.days[1]).toEqual({
      day: '2026-09-02',
      blank: false,
      condition_ai: 3,
      condition_user: 2,
      good: ['朝に設計した'],
      insight: ['午後に止まる'],
      next_action: '週報は朝に書く',
    });
  });

  it('振り返りの全文は送らず、日次 FB のない日だけ振り返りの冒頭を送る', () => {
    const { payload } = buildMonthlySummaryInput('プロンプト', data);
    expect(payload.days[0]).toMatchObject({ reflection_head: '集中できた\n朝に始めると続く' });
    expect(JSON.stringify(payload)).not.toContain('FB がある日の振り返りの全文');
    expect(payload.days[2]).toEqual({
      day: '2026-09-03',
      blank: true,
      condition_ai: null,
      condition_user: null,
    });
  });

  it('振り返りの冒頭は決まった文字数で切り、切ったことを示す', () => {
    const long = buildMonthlySummaryInput('プロンプト', {
      ...data,
      days: [day('2026-09-01', { reflection: { thoughtsMd: 'あ'.repeat(500), learningMd: '' } })],
    });
    expect(long.payload.days[0]?.reflection_head).toBe(
      'あ'.repeat(REFLECTION_HEAD_CHARS) + TRUNCATION_MARKER,
    );
  });

  it('空白だけの振り返りは、冒頭として送らない', () => {
    const { payload } = buildMonthlySummaryInput('プロンプト', {
      ...data,
      days: [day('2026-09-01', { reflection: { thoughtsMd: '  ', learningMd: '\n' } })],
    });
    expect(payload.days[0]).not.toHaveProperty('reflection_head');
  });

  it('上限を超えたら古い日から振り返りの冒頭を省き、それでも超えたら古い日のよかったことと気づきを省く', () => {
    const many: MonthlySummaryData = {
      ...data,
      days: Array.from({ length: 20 }, (_, i) => {
        const d = `2026-09-${String(i + 1).padStart(2, '0')}`;
        return i < 10
          ? day(d, { reflection: { thoughtsMd: 'い'.repeat(300), learningMd: '' } })
          : day(d, {
              feedback: {
                good: ['う'.repeat(200)],
                insight: ['え'.repeat(200)],
                nextAction: '一手',
              },
            });
      }),
    };
    const full = buildMonthlySummaryInput('プロンプト', many);
    const maxChars = full.charCount - 3_000;
    const trimmed = buildMonthlySummaryInput('プロンプト', many, { maxChars });
    expect(trimmed.charCount).toBeLessThanOrEqual(maxChars);
    // 振り返りの冒頭はすべて省き、よかったことと気づきは古い日の分だけ省く
    expect(trimmed.payload.days.slice(0, 10).every((d) => d.reflection_head === undefined)).toBe(
      true,
    );
    expect(trimmed.payload.days.at(-1)).toMatchObject({
      good: ['う'.repeat(200)],
      next_action: '一手',
    });
    expect(trimmed.payload.days[10]).toEqual({
      day: '2026-09-11',
      blank: false,
      condition_ai: null,
      condition_user: null,
      next_action: '一手',
    });
    expect(trimmed.annotations[0]).toMatchObject({
      kind: 'omitted',
      path: 'days.2026-09-01',
      reason: expect.stringContaining('振り返りの冒頭'),
    });
    expect(trimmed.annotations.some((a) => a.reason.includes('よかったことと気づき'))).toBe(true);
  });

  it('上限に収まっていれば何も省かない', () => {
    expect(buildMonthlySummaryInput('プロンプト', data).annotations).toEqual([]);
  });
});

describe('FR-A13 月次総括の入力のタグ', () => {
  it('タグごとの集計を stats.by_tag として、数えた値のまま渡す。タグなしは null', () => {
    const { payload } = buildMonthlySummaryInput('プロンプト', data);
    expect(payload.stats.by_tag).toEqual([
      { tag: '仕事', completed: 3, doing_days: 5, waiting_days: 1 },
      { tag: null, completed: 1, doing_days: 1, waiting_days: 0 },
    ]);
  });

  it('タグの名前は30文字までに収める（NFR-15）', () => {
    const { payload } = buildMonthlySummaryInput('プロンプト', {
      ...data,
      stats: {
        ...data.stats,
        byTag: [{ tag: 'い'.repeat(50), completed: 1, doingDays: 1, waitingDays: 0 }],
      },
    });
    expect(payload.stats.by_tag[0]?.tag).toHaveLength(30);
  });

  it('絵文字を含む30文字のタグの名前は、途中で切らずにそのまま送る', () => {
    const emoji = '🍣'.repeat(30);
    const { payload } = buildMonthlySummaryInput('プロンプト', {
      ...data,
      stats: { ...data.stats, byTag: [{ tag: emoji, completed: 1, doingDays: 1, waitingDays: 0 }] },
    });
    expect(payload.stats.by_tag[0]?.tag).toBe(emoji);
  });

  it('NFR-15 タグの集計だけで上限を超えるときは、動きの少ないタグから省き、注記を付ける', () => {
    const byTag = Array.from({ length: 400 }, (_, i) => ({
      tag: `タグ${String(i).padStart(3, '0')}${'あ'.repeat(20)}`,
      completed: i,
      doingDays: 0,
      waitingDays: 0,
    }));
    const { payload, annotations, charCount } = buildMonthlySummaryInput('プロンプト', {
      ...data,
      stats: { ...data.stats, byTag },
    });
    expect(charCount).toBeLessThanOrEqual(20_000);
    expect(payload.stats.by_tag.length).toBeLessThan(400);
    // 残るのは動きの多いタグ
    expect(payload.stats.by_tag.some((t) => t.completed === 399)).toBe(true);
    expect(payload.stats.by_tag.some((t) => t.completed === 0)).toBe(false);
    expect(annotations.some((a) => a.path.startsWith('stats.by_tag.'))).toBe(true);
  });
});
