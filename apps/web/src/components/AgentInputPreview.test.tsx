import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentInputPreview } from '../api/agentInput';
import { AgentInputPreviewView, groupAnnotations, renderedPaths } from './AgentInputPreview';

const base: AgentInputPreview = {
  payload: {
    day: '2026-09-23',
    reflection: {
      thoughts_md: '集中できた…（上限を超えたため、以降を省略しました）',
      learning_md: '',
    },
    tasks: [
      { title: '企画書を書く', status: 'doing', parent: 'Q4計画', days: 3 },
      { title: '週報', status: 'done', days: 1 },
    ],
    stats: { planned: 2, done: 1, doing: 1, paused: 0, waiting: 0 },
    recent: [{ day: '2026-09-22', condition: 3, next_action: '朝に見出しを書く', blank: false }],
  },
  annotations: [],
  charCount: 1234,
  payloadHash: `sha256:${'0'.repeat(64)}`,
};

const render = (preview: AgentInputPreview) =>
  renderToStaticMarkup(<AgentInputPreviewView preview={preview} />);

describe('FR-A12 送信内容のプレビューの表示', () => {
  it('振り返り、タスク、集計値、直近の情報の順に項目ごとに表示する', () => {
    const html = render(base);
    const order = [
      'aria-label="振り返り"',
      'aria-label="タスク"',
      'aria-label="集計値"',
      'aria-label="直近の情報"',
    ].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('企画書を書く');
    expect(html).toContain('着手中・3日目・親：Q4計画');
    expect(html).toContain('1,234文字');
  });

  it('送る JSON をそのまま（文字数を数えたのと同じ形で）表示する', () => {
    const html = render(base);
    const escaped = renderToStaticMarkup(<>{JSON.stringify(base.payload, null, 2)}</>);
    expect(html).toContain(escaped);
  });

  it('切り詰めた箇所は、その項目を強調して理由を添える', () => {
    const html = render({
      ...base,
      annotations: [
        {
          kind: 'truncated',
          path: 'reflection.thoughts_md',
          reason: '上限の12,000文字を超えたため末尾を切り詰めました',
        },
      ],
    });
    expect(html).toMatch(
      /<div class="input-field" data-annotated="true"><h4>思考の整理<\/h4>.*切り詰め<\/span>上限の12,000文字を超えたため末尾を切り詰めました/,
    );
    expect(html).toContain('加工した箇所が1件あります');
  });

  it('省いた項目は payload に残らないので、見出しの下に理由を出し、同じ位置の別の項目は強調しない', () => {
    const html = render({
      ...base,
      annotations: [
        { kind: 'omitted', path: 'recent.2026-09-16', reason: '古い日の情報を省きました' },
        { kind: 'omitted', path: 'tasks.0', reason: '除外しました' },
      ],
    });
    expect(html).toMatch(
      /<h3>直近の情報<\/h3><p class="input-annotation">.*古い日の情報を省きました/,
    );
    expect(html).toMatch(/<h3>タスク<\/h3><p class="input-annotation">.*除外しました/);
    expect(html).not.toContain('<li data-annotated="true">');
  });

  it('知らない項目の注記も、画面を変えずに「その他」として表示する', () => {
    const grouped = groupAnnotations([
      { kind: 'truncated', path: 'future.field', reason: '将来の加工' },
      { kind: 'omitted', path: 'recent.2026-09-16', reason: '省いた' },
    ]);
    expect(grouped.get('other')).toHaveLength(1);
    expect(grouped.get('recent')).toHaveLength(1);
    expect(
      render({
        ...base,
        annotations: [{ kind: 'truncated', path: 'future.field', reason: '将来の加工' }],
      }),
    ).toContain('将来の加工');
  });

  it('振り返りがない日は、送らないことを示す', () => {
    const { reflection: _, ...payload } = base.payload;
    expect(render({ ...base, payload })).toContain('振り返りは送りません');
    expect(renderedPaths(payload)).toEqual(new Set(['tasks.0', 'tasks.1']));
  });
});
