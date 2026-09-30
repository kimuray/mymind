import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DaySummary, formatSummary } from './DaySummary';

const summary = {
  completed: [
    { taskId: 'a', title: 'PRレビュー' },
    { taskId: 'b', title: '経費精算' },
  ],
  started: [
    { taskId: 'c', title: 'D1のスキーマ設計', isNew: true, dayOrdinal: 1 },
    { taskId: 'd', title: '企画書ドラフト', isNew: false, dayOrdinal: 3 },
  ],
  changes: [
    { kind: 'waiting_continues' as const, taskId: 'e', title: '競合調査', dayOrdinal: 5 },
    {
      kind: 'changed' as const,
      taskId: 'f',
      title: '週報',
      from: 'doing' as const,
      to: 'paused' as const,
    },
  ],
};

describe('FR-D07 記録のまとめの表示', () => {
  it('Figma の例と同じ書き方にする', () => {
    expect(formatSummary(summary)).toEqual({
      completed: 'PRレビュー、経費精算',
      started: 'D1のスキーマ設計（新規）、企画書ドラフト（3日目）',
      changes: '競合調査：待ちが継続（5日目）／週報：着手中 → 中断',
    });
  });

  it('件数を見出しに添え、何もない欄は「なし」と出す', () => {
    const html = renderToStaticMarkup(
      <DaySummary summary={{ completed: [], started: summary.started, changes: [] }} />,
    );
    expect(html).toContain('完了 <span class="day-summary-count">0</span>');
    expect(html).toContain('着手 <span class="day-summary-count">2</span>');
    expect(html).toContain('<p class="day-summary-empty">なし</p>');
  });
});
