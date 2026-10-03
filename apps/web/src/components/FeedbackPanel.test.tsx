import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { effectiveLevel, FeedbackPanel, feedbackState } from './FeedbackPanel';

const feedback = {
  id: 'f1',
  period: '2026-09-22',
  agent: 'claude',
  promptVersion: '0.1.0',
  createdAt: '2026-09-22T12:00:00.000Z',
  content: {
    condition: { level: 3, reason: '設計に集中できた' },
    good: ['午前に細かい作業を片付けた'],
    insight: ['割り込みで止まりやすい'],
    next_action: '週報は朝いちばんに',
  },
};
const job = (status: string, error: string | null = null) => ({
  id: 'j1',
  kind: 'daily_feedback' as const,
  period: '2026-09-22',
  agent: 'fake',
  status: status as 'queued',
  error,
  createdAt: '2026-09-22T11:59:00.000Z',
  startedAt: null,
  finishedAt: null,
});
const condition = (aiLevel: number | null, userLevel: number | null) => ({
  day: '2026-09-22',
  aiLevel,
  aiReason: aiLevel === null ? null : '設計に集中できた',
  userLevel,
  updatedAt: '2026-09-22T12:00:00.000Z',
});
const render = (props: Partial<Parameters<typeof FeedbackPanel>[0]>) =>
  renderToStaticMarkup(
    <FeedbackPanel
      heading="今日のフィードバック"
      feedback={null}
      condition={null}
      job={null}
      onRequest={() => {}}
      onChangeCondition={() => {}}
      {...props}
    />,
  );

describe('FR-A08 FB の状態', () => {
  it('最新のジョブが待機中か実行中なら生成中、失敗なら失敗', () => {
    expect(feedbackState(feedback, job('queued'))).toBe('generating');
    expect(feedbackState(feedback, job('running'))).toBe('generating');
    expect(feedbackState(null, job('failed'))).toBe('failed');
  });

  it('ジョブが終わっていれば、FB があれば完了、なければ未依頼', () => {
    expect(feedbackState(feedback, job('succeeded'))).toBe('done');
    expect(feedbackState(null, job('cancelled'))).toBe('none');
    expect(feedbackState(null, null)).toBe('none');
  });

  it('生成中は考えているマメと進み具合、失敗は理由と再試行を出す', () => {
    const generating = render({ job: job('running') });
    expect(generating).toContain('data-mood="think"');
    expect(generating).toContain('マメが考えています');
    const failed = render({ job: job('failed', '120秒以内に応答がなかったため中止しました') });
    expect(failed).toContain('FBをもらえませんでした：120秒以内に応答がなかったため中止しました');
    expect(failed).toContain('再試行');
  });
});

describe('FR-A08 順番待ち（#23）', () => {
  it('待機中のジョブは、前の依頼を待っていることを出し、実行中なら出さない', () => {
    expect(render({ job: job('queued') })).toContain('前の依頼が終わるのを待っています');
    expect(render({ job: job('running') })).not.toContain('前の依頼が終わるのを待っています');
  });
});

describe('FR-A09 FB のない日', () => {
  it('調子は空欄で、おやすみ中のマメと依頼のボタンを出す', () => {
    const html = render({});
    expect(html).toContain('data-mood="sleep"');
    expect(html).toContain('まだFBをもらっていません');
    expect(html).toContain('FBをもらう');
  });
});

describe('FR-A02 FR-A04 FB の中身', () => {
  it('よかったこと・気づき・明日の一手と、生成日時とエージェント、もう一度もらうを出す', () => {
    const html = render({ feedback, condition: condition(3, null), job: job('succeeded') });
    expect(html).toContain('よかったこと');
    expect(html).toContain('割り込みで止まりやすい');
    expect(html).toContain('明日の一手');
    expect(html).toContain('9月22日 21:00 に Claude Code で生成');
    expect(html).toContain('もう一度もらう');
    expect(html).toContain('AI判定の根拠：設計に集中できた');
  });
});

describe('FR-A03 調子の手動の値', () => {
  it('手動の値があればそれを出し、AI の判定と違えば両方が分かるようにする', () => {
    expect(effectiveLevel(condition(3, 1))).toBe(1);
    expect(effectiveLevel(condition(3, null))).toBe(3);
    expect(effectiveLevel(null)).toBeNull();
    const html = render({ feedback, condition: condition(3, 1) });
    expect(html).toContain('手動で修正（AIの判定：好調）');
    expect(html).toContain('data-mood="bad"');
  });
});
