import {
  createDailyLogRepository,
  createJobRepository,
  createTaskRepository,
  MIGRATIONS_FOLDER,
  openDatabase,
  plainCodec,
} from '@mymind/db';
import { describe, expect, it } from 'vitest';
import {
  BLANK_OFFSETS,
  checkSeedTarget,
  MANUAL_CONDITION_OFFSET,
  NO_FEEDBACK_OFFSET,
  SEED_DAYS,
  seedDatabase,
  shiftDay,
} from './seed';

const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };
/** 2026-10-11 14:00（日本時間） */
const NOW = new Date('2026-10-11T05:00:00.000Z');
const TODAY = '2026-10-11';

async function seeded() {
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  const range = await seedDatabase({ db, now: NOW, dayOptions: DAY_OPTIONS });
  return {
    range,
    tasks: createTaskRepository({ db, codec: plainCodec, newEventId: () => 'unused' }),
    logs: createDailyLogRepository({ db, codec: plainCodec }),
    jobs: createJobRepository({ db, codec: plainCodec }),
  };
}

describe('開発用のシードデータ（issue 017）', () => {
  it('今日を最終日として、2週間分を入れる', async () => {
    const { range } = await seeded();
    expect(range).toEqual({ from: shiftDay(TODAY, -(SEED_DAYS - 1)), to: TODAY });
    expect(range.from).toBe('2026-09-28');
  });

  it('空白日のほかは、毎日計画を確定し、過去の日には振り返りがある', async () => {
    const { logs } = await seeded();
    for (let offset = SEED_DAYS - 1; offset >= 0; offset--) {
      const day = shiftDay(TODAY, -offset);
      const log = logs.find(day);
      if ((BLANK_OFFSETS as readonly number[]).includes(offset)) {
        expect(log, day).toBeUndefined();
        continue;
      }
      expect(log?.planConfirmedAt ?? null, day).not.toBeNull();
      if (offset > 0) expect(log?.thoughtsMd, day).not.toBe('');
    }
  });

  it('FB を依頼しなかった日と空白日、今日のほかは、日次 FB と調子がある', async () => {
    const { jobs } = await seeded();
    for (let offset = SEED_DAYS - 1; offset >= 0; offset--) {
      const day = shiftDay(TODAY, -offset);
      const skipped =
        offset === 0 ||
        offset === NO_FEEDBACK_OFFSET ||
        (BLANK_OFFSETS as readonly number[]).includes(offset);
      expect(jobs.listFeedbacks('daily', day).length, day).toBe(skipped ? 0 : 1);
      if (!skipped) expect(jobs.findCondition(day)?.aiLevel, day).toBe(3);
    }
  });

  it('調子を手で直した日が1日ある', async () => {
    const { jobs } = await seeded();
    const day = shiftDay(TODAY, -MANUAL_CONDITION_OFFSET);
    expect(jobs.findCondition(day)).toMatchObject({ aiLevel: 3, userLevel: 1 });
  });

  it('今日の計画に、着手中と未着手のタスクがある', async () => {
    const { tasks } = await seeded();
    const statuses = tasks.listPlan(TODAY).map((t) => t.status);
    expect(statuses).toContain('doing');
    expect(statuses).toContain('todo');
  });

  it('バックログへ送った着手中のタスクは中断になり、翌日以降に計画へ戻せる（FR-T06）', async () => {
    const { tasks } = await seeded();
    const draft = tasks.listPlan(TODAY).find((t) => t.title === '企画書ドラフトを書く');
    expect(draft?.status).toBe('doing');
    const events = tasks.listEventsOfTasks([draft?.id ?? '']).get(draft?.id ?? '') ?? [];
    const movedDay = shiftDay(TODAY, -2);
    expect(
      events.some((e) => e.type === 'status_changed' && e.to === 'paused' && e.day === movedDay),
    ).toBe(true);
    expect(events.some((e) => e.type === 'planned' && e.day === movedDay)).toBe(false);
  });
});

describe('シードを入れる先の確認（issue 017）', () => {
  const home = '/Users/me';
  const none = () => false;

  it('MYMIND_DATA_DIR を指定していなければ断る', () => {
    expect(checkSeedTarget({}, home, none)).toEqual({
      ok: false,
      error: { kind: 'data_dir_missing' },
    });
  });

  it('実データのディレクトリとその中は断る', () => {
    for (const dir of ['/Users/me/.mymind', '/Users/me/.mymind/', '/Users/me/.mymind/sub']) {
      expect(checkSeedTarget({ MYMIND_DATA_DIR: dir }, home, none)).toMatchObject({
        ok: false,
        error: { kind: 'real_data_dir' },
      });
    }
  });

  it('名前が似ているだけの別のディレクトリは使える', () => {
    expect(checkSeedTarget({ MYMIND_DATA_DIR: '/Users/me/.mymind-dev' }, home, none)).toEqual({
      ok: true,
      dataDir: '/Users/me/.mymind-dev',
    });
  });

  it('DB が既にあれば上書きせずに断る', () => {
    expect(checkSeedTarget({ MYMIND_DATA_DIR: '/work/.data' }, home, () => true)).toMatchObject({
      ok: false,
      error: { kind: 'database_exists' },
    });
  });
});
