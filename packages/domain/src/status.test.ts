import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isCompletionUndo,
  nextOnAdvance,
  STATUS_LABELS,
  STATUSES,
  TRANSITIONS,
} from './status';

describe('FR-T03 ステータス遷移', () => {
  it('6つのステータスを持つ', () => {
    expect(STATUSES).toEqual(['todo', 'doing', 'paused', 'waiting', 'done', 'cancelled']);
  });

  it('すべてのステータスに日本語のラベルがある', () => {
    for (const s of STATUSES) expect(STATUS_LABELS[s]).toBeTruthy();
  });

  it.each([
    ['todo', 'doing'],
    ['doing', 'paused'],
    ['doing', 'waiting'],
    ['paused', 'doing'],
    ['waiting', 'done'],
    ['done', 'todo'],
    ['cancelled', 'todo'],
  ] as const)('%s から %s へ遷移できる', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['todo', 'done'],
    ['todo', 'paused'],
    ['cancelled', 'doing'],
    ['done', 'cancelled'],
  ] as const)('%s から %s へは遷移できない', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('同じステータスへの遷移は許可しない', () => {
    for (const s of STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('遷移先はすべて定義済みのステータスである', () => {
    for (const s of STATUSES) {
      for (const to of TRANSITIONS[s]) expect(STATUSES).toContain(to);
    }
  });
});

describe('FR-U01 Space で状態を進める', () => {
  it.each([
    ['todo', 'doing'],
    ['doing', 'done'],
    ['paused', 'doing'],
    ['waiting', 'doing'],
    ['done', 'todo'],
  ] as const)('%s は %s に進む', (from, to) => {
    expect(nextOnAdvance(from)).toBe(to);
  });

  it('中止したタスクは Space で進めない', () => {
    expect(nextOnAdvance('cancelled')).toBeNull();
  });

  it('Space で進める先は必ず遷移表で許可されている', () => {
    for (const s of STATUSES) {
      const next = nextOnAdvance(s);
      if (next !== null) expect(canTransition(s, next)).toBe(true);
    }
  });
});

describe('FR-T04 完了の取り消し', () => {
  it('完了から未着手・着手中への遷移は取り消しとして扱う', () => {
    expect(isCompletionUndo('done', 'todo')).toBe(true);
    expect(isCompletionUndo('done', 'doing')).toBe(true);
  });

  it('それ以外の遷移は取り消しではない', () => {
    expect(isCompletionUndo('doing', 'done')).toBe(false);
    expect(isCompletionUndo('cancelled', 'todo')).toBe(false);
  });
});
