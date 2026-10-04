import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';
import { createScheduler, DEFAULT_MAX_WAIT_MS, type ScheduledJob } from './scheduler';

const jst = (s: string) => new Date(`${s.replace(' ', 'T')}:00+09:00`);

/** 時計とタイマーを手で進めるための偽物 */
function setup(start: string) {
  let now = jst(start);
  let pending: { fn: () => void; delayMs: number } | null = null;
  const lines: string[] = [];
  const scheduler = createScheduler({
    now: () => now,
    timeZone: 'Asia/Tokyo',
    setTimer: (fn, delayMs) => {
      pending = { fn, delayMs };
      return {
        cancel: () => {
          pending = null;
        },
      };
    },
    logger: createLogger({ write: (line) => lines.push(line), now: () => now }),
  });
  return {
    scheduler,
    lines,
    pending: () => pending,
    /** 時計を進めて、置いてあるタイマーを発火させる */
    fireAt: async (at: Date) => {
      now = at;
      const p = pending;
      if (p === null) throw new Error('タイマーがありません');
      p.fn();
      await Promise.resolve();
    },
  };
}

const job = (id: string, time: string | null, runs: Date[], extra: Partial<ScheduledJob> = {}) => ({
  id,
  spec: () => (time === null ? null : { time }),
  run: (scheduledAt: Date) => {
    runs.push(scheduledAt);
  },
  ...extra,
});

describe('NFR-19 スケジューラ', () => {
  it('次の予定の時刻にタイマーを1本だけ置き、動かしたら翌日の時刻を計算し直す', async () => {
    const t = setup('2026-09-23 08:20');
    const runs: Date[] = [];
    t.scheduler.add(job('morning', '08:30', runs));
    t.scheduler.add(job('night', '21:30', runs));
    t.scheduler.start();
    expect(t.pending()?.delayMs).toBe(10 * 60 * 1000);

    await t.fireAt(jst('2026-09-23 08:30'));
    expect(runs).toEqual([jst('2026-09-23 08:30')]);
    expect(t.scheduler.nextRun('morning')).toEqual(jst('2026-09-24 08:30'));
    expect(t.scheduler.nextRun('night')).toEqual(jst('2026-09-23 21:30'));
  });

  it('遠い予定でも、待つのは最長15分で、時刻が来るまでは動かさない', async () => {
    const t = setup('2026-09-23 09:00');
    const runs: Date[] = [];
    t.scheduler.add(job('night', '21:30', runs));
    t.scheduler.start();
    expect(t.pending()?.delayMs).toBe(DEFAULT_MAX_WAIT_MS);
    await t.fireAt(jst('2026-09-23 09:15'));
    expect(runs).toEqual([]);
    expect(t.pending()).not.toBeNull();
  });

  it('スリープから復帰して、時刻を過ぎてから2時間以内なら動かす', async () => {
    const t = setup('2026-09-23 21:00');
    const runs: Date[] = [];
    t.scheduler.add(job('night', '21:30', runs));
    t.scheduler.start();
    await t.fireAt(jst('2026-09-23 22:45'));
    expect(runs).toEqual([jst('2026-09-23 21:30')]);
  });

  it('時刻を過ぎてから2時間を超えて復帰したら、その回は見送り、翌日の時刻にする', async () => {
    const t = setup('2026-09-23 21:00');
    const runs: Date[] = [];
    t.scheduler.add(job('night', '21:30', runs));
    t.scheduler.start();
    await t.fireAt(jst('2026-09-24 00:31'));
    expect(runs).toEqual([]);
    expect(t.scheduler.nextRun('night')).toEqual(jst('2026-09-24 21:30'));
    expect(t.lines.join('\n')).toContain('見送りました');
  });

  it('何日も眠っていても、過ぎた回をまとめて動かさない', async () => {
    const t = setup('2026-09-23 08:00');
    const runs: Date[] = [];
    t.scheduler.add(job('morning', '08:30', runs));
    t.scheduler.start();
    await t.fireAt(jst('2026-09-26 09:00'));
    expect(runs).toEqual([]);
    expect(t.scheduler.nextRun('morning')).toEqual(jst('2026-09-27 08:30'));
  });

  it('予定が止められていれば動かさず、設定が変わったら組み直す', () => {
    const t = setup('2026-09-23 08:00');
    let time: string | null = null;
    const runs: Date[] = [];
    t.scheduler.add({
      id: 'morning',
      spec: () => (time === null ? null : { time }),
      run: (at) => {
        runs.push(at);
      },
    });
    t.scheduler.start();
    expect(t.scheduler.nextRun('morning')).toBeNull();
    expect(t.pending()).toBeNull();
    time = '09:00';
    t.scheduler.reschedule();
    expect(t.scheduler.nextRun('morning')).toEqual(jst('2026-09-23 09:00'));
    expect(t.pending()?.delayMs).toBe(DEFAULT_MAX_WAIT_MS);
  });

  it('1件が失敗しても記録して、ほかの予定は動かす', async () => {
    const t = setup('2026-09-23 08:00');
    const runs: Date[] = [];
    t.scheduler.add(
      job('broken', '08:30', runs, {
        run: () => {
          throw new Error('壊れた');
        },
      }),
    );
    t.scheduler.add(job('backup', '08:30', runs));
    t.scheduler.start();
    await t.fireAt(jst('2026-09-23 08:30'));
    expect(runs).toEqual([jst('2026-09-23 08:30')]);
    expect(t.lines.join('\n')).toContain('定期処理に失敗しました');
  });

  it('止めたら、タイマーを外す', () => {
    const t = setup('2026-09-23 08:00');
    t.scheduler.add(job('morning', '08:30', []));
    t.scheduler.start();
    expect(t.pending()).not.toBeNull();
    t.scheduler.stop();
    expect(t.pending()).toBeNull();
  });
});
