import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus } from '@mymind/agent';
import type { Job } from '@mymind/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createHealthApi, findLatestBackup, type HealthDeps, latestBackupOf } from './health';

const PORT = 4820;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mymind-health-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fakeAgent: AgentStatus = { name: 'fake', usable: true, executable: null, message: null };

function request(overrides: Partial<HealthDeps> = {}) {
  const deps: HealthDeps = {
    checkDatabase: () => ({ ok: true }),
    databaseFiles: [],
    backupsDirs: () => [join(dir, 'backups')],
    dailyBackup: () => null,
    jobs: { latestFailure: () => undefined },
    agentStatus: async () => fakeAgent,
    ...overrides,
  };
  const app = createApp({ ports: [PORT], sessionToken: 'token' }, createHealthApi(deps));
  return app.request('/api/health', { headers: { Host: `127.0.0.1:${PORT}` } });
}

describe('NFR-21 GET /api/health', () => {
  it('すべて問題なければ ok を返す。読むだけなのでトークンは求めない', async () => {
    const res = await request();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      database: { ok: true, message: null, sizeBytes: 0 },
      agent: fakeAgent,
      backup: null,
      recentFailure: null,
    });
  });

  it('エージェントが見つからなければ degraded にし、理由を返す', async () => {
    const missing: AgentStatus = {
      name: 'claude',
      usable: false,
      executable: { found: false, version: null },
      message: 'claude が見つかりません（PATH を確認してください）',
    };
    const res = await request({ agentStatus: async () => missing });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'degraded', agent: missing });
  });

  it('DB に問い合わせられなければ 503 を返す', async () => {
    const res = await request({ checkDatabase: () => ({ ok: false, message: 'disk I/O error' }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: 'degraded',
      database: { ok: false, message: 'disk I/O error' },
    });
  });

  it('DB のサイズは、本体と WAL のファイルの合計', async () => {
    writeFileSync(join(dir, 'mymind.db'), 'x'.repeat(100));
    writeFileSync(join(dir, 'mymind.db-wal'), 'x'.repeat(20));
    const res = await request({
      databaseFiles: ['', '-wal', '-shm'].map((s) => join(dir, `mymind.db${s}`)),
    });
    expect(await res.json()).toMatchObject({ database: { sizeBytes: 120 } });
  });

  it('直近の FB 生成の失敗を返す', async () => {
    const failed: Job = {
      id: 'j1',
      kind: 'daily_feedback',
      period: '2026-09-24',
      agent: 'fake',
      status: 'failed',
      error: '120秒以内に応答がなかったため中止しました',
      createdAt: '2026-09-24T12:00:00.000Z',
      startedAt: '2026-09-24T12:00:01.000Z',
      finishedAt: '2026-09-24T12:02:01.000Z',
    };
    const res = await request({ jobs: { latestFailure: () => failed } });
    expect(await res.json()).toMatchObject({
      recentFailure: {
        jobId: 'j1',
        kind: 'daily_feedback',
        period: '2026-09-24',
        error: '120秒以内に応答がなかったため中止しました',
        finishedAt: '2026-09-24T12:02:01.000Z',
      },
    });
  });
});

describe('NFR-21 最後のバックアップ', () => {
  it('backups/ の中で、ファイル名の時刻がいちばん新しいものを返す', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    for (const f of [
      'pre-migration-20260920T010000Z.db',
      'before-restore-20260925T075324Z.db',
      'pre-migration-20260924T230000Z.db',
      'メモ.txt',
    ]) {
      writeFileSync(join(backups, f), '');
    }
    expect(findLatestBackup(backups)).toEqual({
      file: 'before-restore-20260925T075324Z.db',
      kind: 'before-restore',
      at: '2026-09-25T07:53:24.000Z',
      result: 'succeeded',
      error: null,
    });
  });

  it('バックアップがまだなければ null', () => {
    expect(findLatestBackup(join(dir, 'backups'))).toBeNull();
  });

  it('NFR-04 データディレクトリと、設定した保存先のうち、いちばん新しいものを返す', () => {
    const inData = join(dir, 'backups');
    const outside = join(dir, 'outside');
    mkdirSync(inData);
    mkdirSync(outside);
    writeFileSync(join(inData, 'pre-migration-20260920T010000Z.db'), '');
    writeFileSync(join(outside, 'daily-20261004T183000Z.db'), '');
    expect(
      latestBackupOf({ backupsDirs: () => [inData, outside], dailyBackup: () => null }),
    ).toMatchObject({ kind: 'daily', at: '2026-10-04T18:30:00.000Z', result: 'succeeded' });
  });

  it('NFR-23 毎日のバックアップの失敗が、残っているファイルより新しければ失敗を返す', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    writeFileSync(join(backups, 'daily-20261003T183000Z.db'), '');
    const failed = {
      at: '2026-10-04T18:30:00.000Z',
      result: 'failed' as const,
      error: '整合性の検査に通りませんでした',
    };
    expect(latestBackupOf({ backupsDirs: () => [backups], dailyBackup: () => failed })).toEqual({
      file: null,
      kind: 'daily',
      at: '2026-10-04T18:30:00.000Z',
      result: 'failed',
      error: '整合性の検査に通りませんでした',
    });
  });

  it('NFR-23 失敗のあとに成功したバックアップがあれば、成功を返す', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    writeFileSync(join(backups, 'daily-20261005T183000Z.db'), '');
    const failed = { at: '2026-10-04T18:30:00.000Z', result: 'failed' as const, error: 'x' };
    expect(
      latestBackupOf({ backupsDirs: () => [backups], dailyBackup: () => failed }),
    ).toMatchObject({ result: 'succeeded', at: '2026-10-05T18:30:00.000Z' });
  });
});
