import Markdown, { defaultUrlTransform } from 'react-markdown';

/**
 * Markdown の表示（DESIGN.md 4.7、NFR-02）。振り返りのプレビューのほか、FB や日付ごとの詳細でも使う。
 * react-markdown は HTML の文字列を作らずに React の要素にするので、dangerouslySetInnerHTML を使わない。
 * 生の HTML は表示せず（rehype-raw を入れない。skipHtml で文字としても出さない）、
 * javascript: などの危険な URL は defaultUrlTransform で空にする（#92 の決定）
 */
export function MarkdownPreview({ source, emptyText }: { source: string; emptyText: string }) {
  if (source.trim() === '') return <p className="markdown-preview-empty">{emptyText}</p>;
  return (
    <div className="markdown-preview">
      <Markdown
        skipHtml
        urlTransform={defaultUrlTransform}
        components={{
          // 振り返りの中のリンクは、アプリの画面を置き換えずに新しいタブで開く
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          // 画像は外部への通信になる（CSP でも止まる）ので、代わりの文字だけを出す
          img: ({ alt }) => (
            <span className="markdown-preview-image">{`［画像：${alt ?? ''}］`}</span>
          ),
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
