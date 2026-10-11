import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RegenerateResponse } from '../api/calendar';
import { formatRecordDiff, RecordRegenerate } from './RecordRegenerate';

const noDiff = { tasks: [], counts: [], completed: { added: [], removed: [] } };
const counts = { planned: 1, done: 1, doing: 0, paused: 0, waiting: 0 };

const changed: RegenerateResponse = {
  day: '2026-09-23',
  hadSnapshot: true,
  changed: true,
  diff: {
    tasks: [
      { kind: 'status_changed', taskId: 'a', title: '企画書', from: 'doing', to: 'done' },
      { kind: 'added', taskId: 'b', title: '見積もり', status: 'todo' },
      { kind: 'removed', taskId: 'c', title: '週報', status: 'doing' },
    ],
    counts: [
      { key: 'done', before: 0, after: 1 },
      { key: 'doing', before: 2, after: 0 },
    ],
    completed: { added: ['企画書', '経費精算'], removed: [] },
  },
  counts,
  hasFeedback: true,
};

const render = (result: RegenerateResponse | undefined, extra: { failed?: boolean } = {}) =>
  renderToStaticMarkup(
    <RecordRegenerate
      result={result}
      busy={false}
      failed={extra.failed ?? false}
      onRegenerate={() => {}}
      onRequestFeedback={() => {}}
    />,
  );

describe('FR-R07 再生成の前後の違いの書き方', () => {
  it('状態の違い、計画の出入り、完了の出入り、件数の順に1行ずつ書く', () => {
    expect(formatRecordDiff(changed.diff ?? noDiff)).toEqual([
      '企画書：着手中 → 完了',
      '見積もり：計画に加わった（未着手）',
      '週報：計画からなくなった',
      // 企画書は状態の違いに出ているので、完了の出入りには重ねない
      '経費精算：完了に加わった',
      '完了 0 → 1',
      '着手中 2 → 0',
    ]);
  });
});

describe('FR-R07 「記録を再生成」の表示', () => {
  it('押す前はボタンだけを出す', () => {
    const html = render(undefined);
    expect(html).toContain('記録を再生成');
    expect(html).not.toContain('変わりはありませんでした');
  });

  it('結果は aria-live の領域に出す', () => {
    expect(render(undefined)).toContain('aria-live="polite"');
  });

  it('変わっていなければ、そう伝える', () => {
    const html = render({ ...changed, changed: false, diff: noDiff });
    expect(html).toContain('変わりはありませんでした');
    expect(html).not.toContain('FBをもう一度もらう');
  });

  it('前の記録がなかった日は、作ったことだけを伝える', () => {
    const html = render({ ...changed, hadSnapshot: false, changed: false, diff: null });
    expect(html).toContain('この日の記録を作りました');
    expect(html).not.toContain('変わりはありませんでした');
  });

  it('変わっていれば違いを並べ、FB がある日は、もう一度もらうかを選べる', () => {
    const html = render(changed);
    expect(html).toContain('<li>企画書：着手中 → 完了</li>');
    expect(html).toContain('FBをもう一度もらう');
  });

  it('FB がない日は、FB の再依頼を出さない', () => {
    expect(render({ ...changed, hasFeedback: false })).not.toContain('FBをもう一度もらう');
  });

  it('失敗したら、そのことを伝える', () => {
    expect(render(undefined, { failed: true })).toContain('記録を再生成できませんでした');
  });
});
