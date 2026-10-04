import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MonthlyInputPreview } from '../api/agentInput';
import { MonthlyInputPreviewView } from './MonthlyInputPreview';

const preview = (extra: Partial<MonthlyInputPreview> = {}): MonthlyInputPreview => ({
  kind: 'monthly_summary',
  payload: {
    month: '2026-09',
    partial: true,
    through: '2026-09-23',
    stats: { recorded_days: 2, blank_days: 1, feedback_days: 1, corrected_days: 1, completed: 4 },
    days: [
      {
        day: '2026-09-01',
        blank: false,
        condition_ai: 3,
        condition_user: 2,
        good: ['朝に設計した'],
        insight: ['午後に止まる'],
        next_action: '週報は朝に書く',
      },
      {
        day: '2026-09-02',
        blank: false,
        condition_ai: null,
        condition_user: null,
        reflection_head: '集中できた',
      },
      { day: '2026-09-03', blank: true, condition_ai: null, condition_user: null },
    ],
  },
  annotations: [],
  charCount: 1234,
  payloadHash: 'sha256:x',
  ...extra,
});

describe('FR-A06 FR-A12 月次総括の送信内容', () => {
  it('集計値を名前つきで出す', () => {
    const html = renderToStaticMarkup(<MonthlyInputPreviewView preview={preview()} />);
    expect(html).toContain('記録のある日');
    expect(html).toContain('調子を手で直した日');
    expect(html).toContain('途中経過');
  });

  it('日ごとに、送る FB の要点（よかったこと・気づき・明日の一手）と振り返りの冒頭をすべて出す', () => {
    const html = renderToStaticMarkup(<MonthlyInputPreviewView preview={preview()} />);
    expect(html).toContain('調子 3 → 手で 2');
    expect(html).toContain('よかったこと：朝に設計した');
    expect(html).toContain('気づき：午後に止まる');
    expect(html).toContain('明日の一手：週報は朝に書く');
    expect(html).toContain('振り返りの冒頭：集中できた');
    expect(html).toContain('記録なし');
  });

  it('上限に合わせて省いた日は、理由を添える', () => {
    const html = renderToStaticMarkup(
      <MonthlyInputPreviewView
        preview={preview({
          annotations: [
            {
              kind: 'omitted',
              path: 'days.2026-09-01',
              reason: '上限の20,000文字を超えたため、古い日のよかったことと気づきを省きました',
            },
          ],
        })}
      />,
    );
    expect(html).toContain('古い日のよかったことと気づきを省きました');
    expect(html).toContain('加工した箇所が1件あります');
  });
});
