import { describe, expect, it } from 'vitest';
import { canAddChildFromDetail } from './TaskDetail';

describe('FR-T02 詳細ペインから子タスクを追加できるか', () => {
  it.each(['todo', 'doing', 'paused', 'waiting'] as const)(
    '親を持たない%sのタスクには追加できる',
    (status) => {
      expect(canAddChildFromDetail({ parentId: null, status })).toBe(true);
    },
  );

  it('子のタスクには追加できない（2階層まで）', () => {
    expect(canAddChildFromDetail({ parentId: 'p1', status: 'todo' })).toBe(false);
  });

  it.each(['done', 'cancelled'] as const)('%sのタスクには追加できない', (status) => {
    expect(canAddChildFromDetail({ parentId: null, status })).toBe(false);
  });
});
