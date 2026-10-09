import { useState } from 'react';
import { useTags } from './api/tags';
import type { ListTask } from './api/tasks';
import { Button } from './components/Button';
import { TagChip } from './components/TagChip';
import { usePaletteCommands } from './keyboard';

/**
 * タグで絞り込む（FR-T14、DESIGN.md 4.23）。そのタグが付いたタスクだけを残す。
 * 親子は付いているかどうかだけで決める。子にだけ付いていれば子だけを残し、行には親の名前のラベルが出る（親が一覧にないとき）。
 * 親に付いていても、付いていない子は残さない
 */
export function filterByTag<T extends Pick<ListTask, 'tags'>>(
  tasks: readonly T[],
  tagId: string | null,
): T[] {
  if (tagId === null) return [...tasks];
  return tasks.filter((t) => t.tags.some((tag) => tag.id === tagId));
}

/**
 * 今日・バックログの絞り込みの状態と、絞り込みの欄。絞り込みは画面を開いている間だけ覚える（URL には入れない）。
 * コマンドパレットにも「タグで絞り込む：<名前>」と「タグの絞り込みを解除」を出す
 */
export function useTagFilter<T extends Pick<ListTask, 'tags'>>(tasks: readonly T[]) {
  const tags = useTags();
  const list = tags.data?.tags ?? [];
  const [tagId, setTagId] = useState<string | null>(null);
  // 絞り込んでいたタグが消えたら（設定の画面や別のタブで削除）、絞り込みをやめる
  const current = tagId === null ? undefined : list.find((t) => t.id === tagId);
  if (tagId !== null && tags.isSuccess && current === undefined) setTagId(null);
  const activeId = current === undefined ? null : tagId;
  const visible = filterByTag(tasks, activeId);

  usePaletteCommands([
    ...list.map((t) => ({
      id: `tag-filter:${t.id}`,
      label: `タグで絞り込む：${t.name}`,
      run: () => setTagId(t.id),
    })),
    ...(activeId === null
      ? []
      : [{ id: 'tag-filter:clear', label: 'タグの絞り込みを解除', run: () => setTagId(null) }]),
  ]);

  const bar =
    list.length === 0 ? null : (
      <div className="tag-filter" data-motion-key="ui:tag-filter">
        <label className="tag-filter-select">
          <span className="text-small">タグで絞り込む</span>
          <select value={activeId ?? ''} onChange={(e) => setTagId(e.target.value || null)}>
            <option value="">すべて</option>
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {current !== undefined && (
          <p className="tag-filter-status" aria-live="polite">
            <TagChip name={current.name} color={current.color} />
            <span className="text-small">
              で絞り込み中（{visible.length} / {tasks.length} 件）
            </span>
            <Button kind="text" onClick={() => setTagId(null)}>
              解除
            </Button>
          </p>
        )}
      </div>
    );

  return { tagId: activeId, visible, bar };
}
