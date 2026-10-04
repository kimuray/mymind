import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_FOLDER, openDatabase } from '@mymind/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDailyBackupStatus, runDailyBackup } from './backups';
import { createDailyBackupJob } from './dailyBackup';
import type { Logger } from './logger';
import { createScheduler, type TimerHandle } from './scheduler';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'mymind-daily-backup-'));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
/** マイグレーションを適用した DB（整合性の検査に通る、mymind の DB） */
const mymindDb = () =>
  openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER }).$client;
const at = (day: number) => new Date(Date.UTC(2026, 9, day, 18, 30, 0));
const dailyFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.startsWith('daily-'))
    .sort();

describe('NFR-04 毎日のバックアップ', () => {
  it('スケジューラが毎日動かすと、スナップショットを作り、14世代を超えたら古いものから消す', async () => {
    const client = mymindDb();
    let now = at(1);
    const job = createDailyBackupJob({
      client,
      dataDir,
      settings: () => ({ backupDir: null, backupGenerations: 14 }),
      now: () => now,
      logger: silent,
    });
    expect(job.spec()).toEqual({ time: '03:30' });
    for (let day = 1; day <= 16; day++) {
      now = at(day);
      await job.run(now);
    }
    const files = dailyFiles(join(dataDir, 'backups'));
    expect(files).toHaveLength(14);
    expect(files[0]).toBe('daily-20261003T183000Z.db');
    expect(files.at(-1)).toBe('daily-20261016T183000Z.db');
    expect(readDailyBackupStatus(dataDir)).toEqual({
      at: '2026-10-16T18:30:00.000Z',
      result: 'succeeded',
      error: null,
    });
  });

  it('マイグレーションの前のスナップショットは、世代に数えず消さない', () => {
    const client = mymindDb();
    const dir = join(dataDir, 'backups');
    mkdirSync(dir);
    runDailyBackup(client, dir, 1, at(1));
    new DatabaseSync(join(dir, 'pre-migration-20260901T000000Z.db')).close();
    runDailyBackup(client, dir, 1, at(2));
    expect(readdirSync(dir).sort()).toEqual([
      'daily-20261002T183000Z.db',
      'pre-migration-20260901T000000Z.db',
    ]);
  });

  it('作ったディレクトリは 700、スナップショットは 600 にする（ADR-0009）', () => {
    const dir = join(dataDir, 'backups');
    const result = runDailyBackup(mymindDb(), dir, 14, at(1));
    expect(result.ok).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, 'daily-20261001T183000Z.db')).mode & 0o777).toBe(0o600);
  });

  it('設定した保存先（データディレクトリの外）に書き、世代数も設定に従う', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mymind-outside-'));
    try {
      const target = join(outside, 'mymind');
      let now = at(1);
      const job = createDailyBackupJob({
        client: mymindDb(),
        dataDir,
        settings: () => ({ backupDir: target, backupGenerations: 2 }),
        now: () => now,
        logger: silent,
      });
      for (let day = 1; day <= 3; day++) {
        now = at(day);
        await job.run(now);
      }
      expect(dailyFiles(target)).toEqual([
        'daily-20261002T183000Z.db',
        'daily-20261003T183000Z.db',
      ]);
      expect(existsSync(join(dataDir, 'backups'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('NFR-23 毎日のバックアップの検査と失敗', () => {
  it('整合性の検査に通らないスナップショットは消して、失敗として記録する', async () => {
    // マイグレーションの記録がない DB は、mymind の DB として戻せないので検査に通らない
    const client = new DatabaseSync(':memory:');
    client.exec('CREATE TABLE t(x)');
    const errors: string[] = [];
    const job = createDailyBackupJob({
      client,
      dataDir,
      settings: () => ({ backupDir: null, backupGenerations: 14 }),
      now: () => at(1),
      logger: { ...silent, error: (message) => errors.push(message) },
    });
    await job.run(at(1));
    expect(dailyFiles(join(dataDir, 'backups'))).toEqual([]);
    expect(readDailyBackupStatus(dataDir)).toMatchObject({
      at: '2026-10-01T18:30:00.000Z',
      result: 'failed',
      error: expect.stringContaining('整合性の検査に通りませんでした'),
    });
    expect(errors).toEqual(['毎日のバックアップに失敗しました']);
  });

  it('保存先に書けなければ、例外にせず失敗として返す', () => {
    const readOnly = join(dataDir, 'readonly');
    mkdirSync(readOnly, { mode: 0o500 });
    const result = runDailyBackup(mymindDb(), join(readOnly, 'sub'), 14, at(1));
    expect(result.ok).toBe(false);
  });

  it('失敗の記録が読めなければ、記録なし（null）として扱う', () => {
    writeFileSync(join(dataDir, 'daily-backup.json'), '{ 壊れた');
    expect(readDailyBackupStatus(dataDir)).toBeNull();
  });
});

describe('NFR-23 毎日のバックアップを取りこぼさない', () => {
  const job = (now: () => Date) =>
    createDailyBackupJob({
      client: mymindDb(),
      dataDir,
      settings: () => ({ backupDir: null, backupGenerations: 14 }),
      now,
      logger: silent,
    });
  const files = () => {
    const dir = join(dataDir, 'backups');
    return existsSync(dir) ? dailyFiles(dir) : [];
  };

  it('3:30 を2時間より過ぎてスリープから復帰しても、見送らずにその日の分を取る', () => {
    // 10月5日 3:00（日本時間）に眠り、3:30 を2時間以上過ぎた 6:00 に復帰する
    let wall = new Date('2026-10-04T18:00:00.000Z').getTime();
    let mono = 0;
    const timer: { fire: () => void } = { fire: () => {} };
    const scheduler = createScheduler({
      now: () => new Date(wall),
      timeZone: 'Asia/Tokyo',
      monotonic: () => mono,
      setTimer: (fn): TimerHandle => {
        timer.fire = fn;
        return { cancel: () => {} };
      },
    });
    scheduler.add(job(() => new Date(wall)));
    scheduler.start();
    wall = new Date('2026-10-04T21:00:00.000Z').getTime();
    mono += 1000;
    timer.fire();
    expect(files()).toEqual(['daily-20261004T210000Z.db']);
    expect(scheduler.nextRun('daily-backup')).toEqual(new Date('2026-10-05T18:30:00.000Z'));
  });

  it('起動したとき、毎日のバックアップがまだなければ取る', () => {
    job(() => at(1)).runIfStale();
    expect(files()).toEqual(['daily-20261001T183000Z.db']);
  });

  it('起動したとき、最後の毎日のバックアップが24時間以内なら取らず、24時間より古ければ取る', () => {
    let now = at(1);
    const j = job(() => now);
    j.runIfStale();
    now = new Date(at(2).getTime() - 1000);
    j.runIfStale();
    expect(files()).toHaveLength(1);
    now = new Date(at(2).getTime() + 1000);
    j.runIfStale();
    expect(files()).toEqual(['daily-20261001T183000Z.db', 'daily-20261002T183001Z.db']);
  });
});
