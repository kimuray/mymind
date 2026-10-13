import { describe, expect, it } from 'vitest';
import { carryoverHeading, previousFeedbackDayLabel } from './MorningPage';

describe('FR-D09 持ち越しの見出し', () => {
  it('前日の計画からなら「昨日の持ち越し」', () => {
    expect(carryoverHeading('2026-09-22', '2026-09-23')).toEqual({
      title: '昨日の持ち越し',
      note: null,
    });
  });

  it('空白日をはさめば、基準日と何日ぶりかを出す', () => {
    expect(carryoverHeading('2026-09-19', '2026-09-23')).toEqual({
      title: '9月19日の持ち越し',
      note: '4日ぶりの計画です',
    });
  });

  it('月をまたいでも暦日で数える', () => {
    expect(carryoverHeading('2026-09-29', '2026-10-01').note).toBe('2日ぶりの計画です');
  });

  it('計画が一度もなければ、見出しだけ', () => {
    expect(carryoverHeading(null, '2026-09-23')).toEqual({ title: '持ち越し', note: null });
  });
});

describe('FR-D02 前日の FB の日付', () => {
  it('日付と曜日の1文字を出す', () => {
    expect(previousFeedbackDayLabel('2026-09-21')).toBe('9月21日（月）');
    expect(previousFeedbackDayLabel('2026-09-30')).toBe('9月30日（水）');
  });
});
