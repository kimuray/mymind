import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentSelect } from './AgentSelect';

const render = (props: Partial<Parameters<typeof AgentSelect>[0]> = {}) =>
  renderToStaticMarkup(
    <AgentSelect id="agent" label="エージェント" value="codex" onChange={() => {}} {...props} />,
  );

describe('FR-A07 エージェントの選択', () => {
  it('Claude Code と Codex だけを並べ、開発用の fake は出さない', () => {
    const html = render();
    expect(html).toContain('>Claude Code</option>');
    expect(html).toContain('>Codex</option>');
    expect(html).not.toContain('fake');
  });

  it('選んでいるエージェントを選択状態にする', () => {
    expect(render({ value: 'codex' })).toMatch(/<option value="codex" selected="">/);
  });

  it('見出しを出さないときは、select に aria-label で名前を付ける', () => {
    const html = render({ showLabel: false, label: '既定のエージェント' });
    expect(html).not.toContain('<label');
    expect(html).toContain('aria-label="既定のエージェント"');
  });
});
