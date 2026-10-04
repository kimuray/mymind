import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StaleTask } from '../api/review';
import { NO_REVIEWS, StocktakePanel, staleNote } from './StocktakePanel';

const task = (extra: Partial<StaleTask> = {}): StaleTask =>
  ({
    id: 't1',
    title: '本棚を整理する',
    status: 'todo',
    createdDay: '2026-08-12',
    daysSinceTouched: 41,
    hasStarted: false,
    ...extra,
  }) as StaleTask;

const render = (props: Partial<Parameters<typeof StocktakePanel>[0]>) =>
  renderToStaticMarkup(
    <StocktakePanel
      tasks={[task()]}
      afterDays={30}
      reviewed={NO_REVIEWS}
      onDecide={() => {}}
      busy={false}
      error={null}
      {...props}
    />,
  );

describe('FR-R06 棚卸しの表示', () => {
  it('一度も着手していないか、どの状態で止まっているかを副題にする', () => {
    expect(staleNote({ hasStarted: false, status: 'todo' })).toBe('一度も着手されていません');
    expect(staleNote({ hasStarted: true, status: 'paused' })).toBe('中断のまま止まっています');
  });

  it('先頭の対象のタスクと、追加した日、最後に触れてからの日数を出す', () => {
    const html = render({});
    expect(html).toContain('本棚を整理する');
    expect(html).toContain('8月12日');
    expect(html).toContain('41日');
    expect(html).toContain('30日以上触れていないタスクを1件ずつ判断');
  });

  it('判断した件数と残りから進み具合を出す', () => {
    const html = render({
      tasks: [task(), task({ id: 't2' })],
      reviewed: { ...NO_REVIEWS, keep: 1 },
    });
    expect(html).toContain('2 / 3');
  });

  it('すべて判断したら、判断ごとの件数をまとめる', () => {
    const html = render({ tasks: [], reviewed: { this_week: 1, keep: 2, drop: 1 } });
    expect(html).toContain('棚卸し完了');
    expect(html).toContain('今週やる 1件・残す 2件・中止 1件');
  });
});
