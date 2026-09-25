import { describe, expect, it } from 'vitest';
import { canTransitionJob, isJobActive, JOB_STATUSES } from './jobs';

describe('FR-A08 ジョブの状態遷移', () => {
  it.each([
    ['queued', 'running'],
    ['queued', 'cancelled'],
    ['running', 'succeeded'],
    ['running', 'failed'],
    ['running', 'cancelled'],
  ] as const)('%s から %s へ変えられる', (from, to) => {
    expect(canTransitionJob(from, to)).toBe(true);
  });

  it.each([
    ['queued', 'succeeded'],
    ['running', 'queued'],
    ['succeeded', 'running'],
    ['failed', 'queued'],
    ['cancelled', 'running'],
  ] as const)('%s から %s へは変えられない', (from, to) => {
    expect(canTransitionJob(from, to)).toBe(false);
  });

  it('待機中と実行中だけがまだ終わっていないジョブ', () => {
    expect(JOB_STATUSES.filter(isJobActive)).toEqual(['queued', 'running']);
  });
});
