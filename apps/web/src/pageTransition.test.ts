import { describe, expect, it } from 'vitest';
import { viewTransitionTypes } from './pageTransition';

describe('FR-U04 画面の切り替え（DESIGN.md 2.9）', () => {
  it('別の画面へ移るときは切り替える', () => {
    expect(viewTransitionTypes('/', '/backlog')).toEqual(['page']);
  });

  it('最初に開いたときは切り替えない', () => {
    expect(viewTransitionTypes(undefined, '/')).toBe(false);
  });

  it('カレンダーで日を選ぶだけなら切り替えない', () => {
    expect(viewTransitionTypes('/calendar/2026-10', '/calendar/2026-10/2026-10-05')).toBe(false);
  });

  it('カレンダーで次の月へ移るときは、進む向きで切り替える', () => {
    expect(viewTransitionTypes('/calendar/2026-10/2026-10-05', '/calendar/2026-11')).toEqual([
      'forward',
    ]);
  });

  it('カレンダーで前の月へ移るときは、戻る向きで切り替える', () => {
    expect(viewTransitionTypes('/calendar/2026-01', '/calendar/2025-12')).toEqual(['backward']);
  });

  it('振り返りで日を変えるだけなら切り替えない', () => {
    expect(viewTransitionTypes('/reflection', '/reflection/2026-10-04')).toBe(false);
  });
});
