import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, MIGRATIONS_FOLDER, openDatabase } from './client';
import { createDailyRecordRepository, type DailyRecordRepository } from './dailyRecordRepository';
import { dailyRecords } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

// 保存時に印を付ける codec。中身が必ず codec を通ることを確かめる
const markingCodec: SensitiveCodec = {
  encode: (plain) => `enc:${plain}`,
  decode: (stored) => stored.replace(/^enc:/, ''),
};

const DAY = '2026-09-26';

let db: Database;
let repo: DailyRecordRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  repo = createDailyRecordRepository({ db, codec: markingCodec });
});

describe('FR-R07 日ごとの記録のスナップショット', () => {
  it('取っていない日は undefined を返す', () => {
    expect(repo.find(DAY)).toBeUndefined();
  });

  it('保存したスナップショットを、きっかけと時刻と一緒に読み出せる', () => {
    repo.save({
      day: DAY,
      record: { counts: { done: 1 } },
      source: 'log_saved',
      at: '2026-09-26T12:00:00.000Z',
    });
    expect(repo.find(DAY)).toEqual({
      day: DAY,
      record: { counts: { done: 1 } },
      generatedAt: '2026-09-26T12:00:00.000Z',
      source: 'log_saved',
    });
  });

  it('同じ日は上書きする（1日に1件）', () => {
    repo.save({ day: DAY, record: { n: 1 }, source: 'log_saved', at: '2026-09-26T12:00:00.000Z' });
    repo.save({
      day: DAY,
      record: { n: 2 },
      source: 'regenerated',
      at: '2026-09-27T01:00:00.000Z',
    });
    expect(repo.find(DAY)).toMatchObject({ record: { n: 2 }, source: 'regenerated' });
    expect(db.select().from(dailyRecords).all()).toHaveLength(1);
  });

  it('NFR-16 中身は codec を通して保存する', () => {
    repo.save({ day: DAY, record: { title: '企画書' }, source: 'log_saved', at: 'x' });
    const row = db.select().from(dailyRecords).where(eq(dailyRecords.day, DAY)).get();
    expect(row?.recordJson).toBe('enc:{"title":"企画書"}');
  });

  it('JSON として読めない中身は null として返す', () => {
    db.insert(dailyRecords)
      .values({ day: DAY, recordJson: 'enc:{壊れている', generatedAt: 'x', source: 'log_saved' })
      .run();
    expect(repo.find(DAY)).toMatchObject({ record: null });
  });
});
