import { describe, expect, it } from 'vitest';
import { resolveAnimatedStatus } from './statusChange';

describe('FR-T03 状態が変わった直後の動き（DESIGN.md 4.2）', () => {
  it('初めて画面に出す状態には、動きを付けない', () => {
    expect(resolveAnimatedStatus(undefined, 'todo', null)).toBeNull();
  });

  it('前に出した状態と同じなら、動きを付けない', () => {
    expect(resolveAnimatedStatus('doing', 'doing', null)).toBeNull();
  });

  it('前に出した状態から変わったら、新しい状態に動きを付ける', () => {
    expect(resolveAnimatedStatus('doing', 'done', null)).toBe('done');
  });

  it('変わった状態のあいだは、再描画しても動きの判断を保つ', () => {
    expect(resolveAnimatedStatus('done', 'done', 'done')).toBe('done');
  });

  it('さらに別の状態に変わったら、その状態に動きを付け直す', () => {
    expect(resolveAnimatedStatus('done', 'todo', 'done')).toBe('todo');
  });

  it('前の判断と違う状態が同じまま描かれても、動きを付けない', () => {
    expect(resolveAnimatedStatus('paused', 'paused', 'doing')).toBeNull();
  });
});
