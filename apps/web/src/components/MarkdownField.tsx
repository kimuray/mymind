import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownPreview } from './MarkdownPreview';

export type MarkdownMode = 'write' | 'preview';

const MODES: readonly { mode: MarkdownMode; label: string }[] = [
  { mode: 'write', label: '書く' },
  { mode: 'preview', label: 'プレビュー' },
];

/**
 * 見出しと「書く／プレビュー」の切り替えが付いた Markdown の欄（Figma「PC/振り返り」、DESIGN.md 4.7）。
 * 切り替えの状態は、⌘P で切り替えられるよう呼び出す側が持つ
 */
export function MarkdownField({
  id,
  label,
  initialValue,
  value,
  onChange,
  mode,
  onModeChange,
}: {
  id: string;
  label: string;
  initialValue: string;
  /** プレビューに出す今の内容 */
  value: string;
  onChange: (value: string) => void;
  mode: MarkdownMode;
  onModeChange: (mode: MarkdownMode) => void;
}) {
  const headingId = `${id}-heading`;
  return (
    <section className="markdown-field" aria-labelledby={headingId} data-markdown-field={id}>
      <div className="markdown-field-head">
        <h2 id={headingId} className="markdown-field-title">
          {label}
        </h2>
        <fieldset className="segmented" aria-label={`${label}の表示`}>
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className="segmented-item"
              aria-pressed={mode === m.mode}
              onClick={() => onModeChange(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="markdown-editor neu-inset-2">
        <MarkdownEditor
          label={label}
          initialValue={initialValue}
          onChange={onChange}
          hidden={mode === 'preview'}
        />
        {mode === 'preview' ? (
          <section className="markdown-editor-body" aria-label={`${label}のプレビュー`}>
            <MarkdownPreview source={value} emptyText="まだ書いていません" />
          </section>
        ) : (
          <p className="markdown-hints" aria-hidden="true">
            <span className="markdown-hints-title">Markdown</span>
            <span>## 見出し</span>
            <span>- リスト</span>
            <span>**太字**</span>
            <span>`コード`</span>
          </p>
        )}
      </div>
    </section>
  );
}
