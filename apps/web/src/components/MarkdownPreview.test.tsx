import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';

const render = (source: string) =>
  renderToStaticMarkup(<MarkdownPreview source={source} emptyText="まだ書いていません" />);

describe('FR-D06 Markdown のプレビュー', () => {
  it('見出し、リスト、太字、コードを要素にする', () => {
    const html = render('## 手応え\n- **設計**に集中\n\n`code`');
    expect(html).toContain('<h2>手応え</h2>');
    expect(html).toContain('<li><strong>設計</strong>に集中</li>');
    expect(html).toContain('<code>code</code>');
  });

  it('空なら、書いていないことを出す', () => {
    expect(render('  \n')).toContain('まだ書いていません');
  });
});

describe('NFR-02 Markdown のサニタイズ', () => {
  it('<script> を含む生の HTML を表示しない', () => {
    const html = render('前<script>alert(1)</script>後\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('javascript: のリンクは URL を空にする', () => {
    const html = render('[押す](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('押す');
  });

  it('リンクは新しいタブで開き、元の画面を参照させない', () => {
    expect(render('[mymind](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">mymind</a>',
    );
  });

  it('画像は読み込まずに、代わりの文字を出す', () => {
    const html = render('![図](https://example.com/a.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('［画像：図］');
  });
});
