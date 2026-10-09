import type { TagColor } from '@mymind/domain';

/** タグの色の日本語名（DESIGN.md 2.2.1）。色だけで区別しないよう、色を選ぶボタンの読み上げに使う */
export const TAG_COLOR_LABELS: Readonly<Record<TagColor, string>> = {
  rose: 'ばら',
  amber: 'こはく',
  green: 'みどり',
  teal: 'あお緑',
  indigo: 'あい',
  plum: 'すみれ',
};

/**
 * タグのチップ（FR-T13、DESIGN.md 4.22）。色の点と名前を出し、色だけで区別しない。
 * onRemove を渡すと、外すボタンを付ける
 */
export function TagChip({
  name,
  color,
  onRemove,
}: {
  name: string;
  color: TagColor;
  onRemove?: () => void;
}) {
  return (
    <span className="tag-chip" data-color={color}>
      <span className="tag-chip-dot" aria-hidden="true" />
      <span className="tag-chip-name">{name}</span>
      {onRemove !== undefined && (
        <button
          type="button"
          className="tag-chip-remove"
          aria-label={`タグ「${name}」を外す`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  );
}

/** 行に出すタグの数。行の高さを変えないよう、残りは「+2」のように数だけを出す */
export const ROW_TAG_LIMIT = 3;

/** リストの行のタグ（FR-T13、DESIGN.md 4.22）。外すボタンは付けず、詳細ペインで外す */
export function RowTags({
  tags,
}: {
  tags: readonly { id: string; name: string; color: TagColor }[];
}) {
  if (tags.length === 0) return null;
  const rest = tags.length - ROW_TAG_LIMIT;
  return (
    <span className="row-tags">
      {tags.slice(0, ROW_TAG_LIMIT).map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color} />
      ))}
      {rest > 0 && (
        <span className="row-tags-more">
          <span aria-hidden="true">+{rest}</span>
          <span className="visually-hidden">
            ほかのタグ：
            {tags
              .slice(ROW_TAG_LIMIT)
              .map((t) => t.name)
              .join('、')}
          </span>
        </span>
      )}
    </span>
  );
}
