import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, MIGRATIONS_FOLDER, openDatabase } from './client';
import { createDailyLogRepository, type DailyLogRepository } from './dailyLogRepository';
import { dailyLogs } from './schema';
import type { SensitiveCodec } from './sensitiveCodec';

// 保存時に印を付ける codec。本文が必ず codec を通ることを確かめる
const markingCodec: SensitiveCodec = {
  encode: (plain) => `enc:${plain}`,
  decode: (stored) => stored.replace(/^enc:/, ''),
};

let db: Database;
let repo: DailyLogRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  repo = createDailyLogRepository({ db, codec: markingCodec });
});

describe('FR-D06 振り返りの保存', () => {
  it('保存していない日は undefined を返す', () => {
    expect(repo.find('2026-09-26')).toBeUndefined();
  });

  it('保存した振り返りを読み出せる', () => {
    repo.saveReflection({
      day: '2026-09-26',
      thoughtsMd: '# 考えたこと',
      learningMd: '- 学び',
      at: '2026-09-26T12:00:00.000Z',
    });
    expect(repo.find('2026-09-26')).toEqual({
      day: '2026-09-26',
      thoughtsMd: '# 考えたこと',
      learningMd: '- 学び',
      planConfirmedAt: null,
      updatedAt: '2026-09-26T12:00:00.000Z',
    });
  });

  it('同じ日に保存し直すと上書きする', () => {
    repo.saveReflection({
      day: '2026-09-26',
      thoughtsMd: '前',
      learningMd: '前',
      at: '2026-09-26T12:00:00.000Z',
    });
    const saved = repo.saveReflection({
      day: '2026-09-26',
      thoughtsMd: '後',
      learningMd: '',
      at: '2026-09-26T13:00:00.000Z',
    });
    expect(saved).toMatchObject({
      thoughtsMd: '後',
      learningMd: '',
      updatedAt: '2026-09-26T13:00:00.000Z',
    });
    expect(repo.find('2026-09-26')).toEqual(saved);
    expect(db.select().from(dailyLogs).all()).toHaveLength(1);
  });

  it('本文は codec を通して保存する', () => {
    repo.saveReflection({
      day: '2026-09-26',
      thoughtsMd: 'a',
      learningMd: 'b',
      at: '2026-09-26T12:00:00.000Z',
    });
    const [row] = db.select().from(dailyLogs).all();
    expect(row).toMatchObject({ thoughtsMd: 'enc:a', learningMd: 'enc:b' });
  });
});
