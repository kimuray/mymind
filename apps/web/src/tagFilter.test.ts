import { describe, expect, it } from 'vitest';
import { filterByTag } from './tagFilter';

const tag = (id: string) => ({ id, name: id, color: 'rose' as const });
const task = (id: string, parentId: string | null, tagIds: string[]) => ({
  id,
  parentId,
  tags: tagIds.map(tag),
});

describe('FR-T14 タグでの絞り込み', () => {
  const tasks = [
    task('parent', null, ['work']),
    task('child-tagged', 'parent', ['work']),
    task('child-untagged', 'parent', []),
    task('other-parent', null, []),
    task('other-child', 'other-parent', ['work', 'home']),
    task('home-only', null, ['home']),
  ];

  it('絞り込んでいなければ、すべてを並びのまま返す', () => {
    expect(filterByTag(tasks, null).map((t) => t.id)).toEqual(tasks.map((t) => t.id));
  });

  it('そのタグが付いたタスクだけを、並びのまま残す', () => {
    expect(filterByTag(tasks, 'work').map((t) => t.id)).toEqual([
      'parent',
      'child-tagged',
      'other-child',
    ]);
  });

  it('子にだけ付いていれば子だけを残し、付いていない親は出さない', () => {
    const ids = filterByTag(tasks, 'work').map((t) => t.id);
    expect(ids).toContain('other-child');
    expect(ids).not.toContain('other-parent');
  });

  it('親に付いていても、付いていない子は残さない', () => {
    expect(filterByTag(tasks, 'work').map((t) => t.id)).not.toContain('child-untagged');
  });

  it('どのタスクにも付いていないタグなら空', () => {
    expect(filterByTag(tasks, 'none')).toEqual([]);
  });
});
