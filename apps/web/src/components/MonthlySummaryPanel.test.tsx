import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MonthSummary, MonthSummaryJob } from '../api/calendar';
import { MonthlySummaryPanel, summaryState, summaryTitle } from './MonthlySummaryPanel';

const summary = (extra: Partial<MonthSummary> = {}): MonthSummary => ({
  id: 's1',
  period: '2026-09',
  agent: 'claude',
  promptVersion: '0.1.0',
  isPartial: false,
  createdAt: '2026-09-30T12:00:00.000Z',
  content: {
    learnings: ['**朝に**設計すると続く'],
    trends: [],
    self_gap: 'ズレは見られませんでした',
    proposals: ['木曜に持ち越しを絞る'],
  },
  ...extra,
});
const job = (status: string): MonthSummaryJob =>
  ({
    id: 'j1',
    kind: 'monthly_summary',
    period: '2026-09',
    agent: 'claude',
    status,
    error: status === 'failed' ? '時間切れ' : null,
    createdAt: '2026-09-30T11:59:00.000Z',
    startedAt: null,
    finishedAt: null,
  }) as MonthSummaryJob;

const render = (props: Partial<Parameters<typeof MonthlySummaryPanel>[0]>) =>
  renderToStaticMarkup(
    <MonthlySummaryPanel
      ym="2026-09"
      summary={null}
      job={null}
      onRequest={() => {}}
      onCancel={() => {}}
      busy={false}
      {...props}
    />,
  );

describe('FR-A06 FR-R05 月次総括の表示', () => {
  it('見出しは「9月の総括」', () => {
    expect(summaryTitle('2026-09')).toBe('9月の総括');
  });

  it('ジョブと総括から、未依頼・生成中・失敗・完了を決める', () => {
    expect(summaryState(null, null)).toBe('none');
    expect(summaryState(summary(), job('running'))).toBe('generating');
    expect(summaryState(summary(), job('failed'))).toBe('failed');
    expect(summaryState(summary(), job('succeeded'))).toBe('done');
  });

  it('総括の項目を出し、空の傾向は出さず、Markdown を表示用に変える', () => {
    const html = render({ summary: summary() });
    expect(html).toContain('学び');
    expect(html).not.toContain('傾向');
    expect(html).toContain('<strong>朝に</strong>');
    expect(html).toContain('来月への提案');
  });

  it('途中経過なら印を付け、提案は残りの日へのものと書く', () => {
    const html = render({ summary: summary({ isPartial: true }) });
    expect(html).toContain('途中経過');
    expect(html).toContain('残りの日への提案');
  });

  it('依頼できない月は、依頼のボタンを出さない', () => {
    const html = renderToStaticMarkup(
      <MonthlySummaryPanel
        ym="2026-12"
        summary={null}
        job={null}
        onCancel={() => {}}
        busy={false}
      />,
    );
    expect(html).toContain('まだ総括をもらっていません');
    expect(html).not.toContain('総括をもらう</button>');
  });
});
