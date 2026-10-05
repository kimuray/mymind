import { createSettingsRepository, MIGRATIONS_FOLDER, openDatabase } from '@mymind/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createScheduler, type TimerHandle } from './scheduler';
import { createSettingsApi, createSettingsReader, notificationScheduleOf } from './settingsApi';

let app: ReturnType<typeof createSettingsApi>;
let repo: ReturnType<typeof createSettingsRepository>;

beforeEach(() => {
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  repo = createSettingsRepository({ db });
  app = createSettingsApi(repo);
});

const BACKUP_DEFAULTS = {
  backupDir: null,
  backupGenerations: 14,
  morningNotification: { enabled: true, time: '08:30' },
  eveningNotification: { enabled: true, time: '21:30' },
  inventoryNotification: { enabled: true, time: '21:45', weekday: 0 },
};
const RUNTIME = { fakeAgent: false, defaultBackupDir: '' };

const patch = (body: unknown) =>
  app.request('/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('FR-A12 設定「依頼の前に毎回確認する」', () => {
  it('保存していなければ、確認しない（false）を返す', async () => {
    const res = await app.request('/settings');
    expect(await res.json()).toEqual({
      settings: {
        confirmBeforeRequest: false,
        defaultAgent: 'claude',
        reviewAfterDays: 30,
        ...BACKUP_DEFAULTS,
      },
      runtime: RUNTIME,
    });
  });

  it('PATCH で変えた値を保存し、GET で読み出せる', async () => {
    const res = await patch({ confirmBeforeRequest: true });
    expect(await res.json()).toEqual({
      settings: {
        confirmBeforeRequest: true,
        defaultAgent: 'claude',
        reviewAfterDays: 30,
        ...BACKUP_DEFAULTS,
      },
      runtime: RUNTIME,
    });
    expect(await (await app.request('/settings')).json()).toEqual({
      settings: {
        confirmBeforeRequest: true,
        defaultAgent: 'claude',
        reviewAfterDays: 30,
        ...BACKUP_DEFAULTS,
      },
      runtime: RUNTIME,
    });
  });

  it.each([
    ['空', {}],
    ['型が違う', { confirmBeforeRequest: 'yes' }],
    ['知らない項目', { confirmBeforeRequest: true, unknown: 1 }],
  ])('%s なら 400 で何も保存しない', async (_, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(repo.getAll()).toEqual({});
  });

  it('保存されている値が読めなければ、初期値として扱う', async () => {
    repo.setMany({ confirmBeforeRequest: 'not json' });
    expect(await (await app.request('/settings')).json()).toEqual({
      settings: {
        confirmBeforeRequest: false,
        defaultAgent: 'claude',
        reviewAfterDays: 30,
        ...BACKUP_DEFAULTS,
      },
      runtime: RUNTIME,
    });
    repo.setMany({ confirmBeforeRequest: '"true"' });
    expect(await (await app.request('/settings')).json()).toEqual({
      settings: {
        confirmBeforeRequest: false,
        defaultAgent: 'claude',
        reviewAfterDays: 30,
        ...BACKUP_DEFAULTS,
      },
      runtime: RUNTIME,
    });
  });
});

describe('FR-A07 設定「既定のエージェント」', () => {
  it('保存していなければ、起動の設定で渡した既定値を返す', async () => {
    const withCodex = createSettingsApi(repo, { defaultAgent: 'codex' });
    const res = await withCodex.request('/settings');
    expect(await res.json()).toMatchObject({ settings: { defaultAgent: 'codex' } });
  });

  it('PATCH で選んだエージェントを保存し、起動の設定より優先する', async () => {
    await patch({ defaultAgent: 'codex' });
    const withClaude = createSettingsApi(repo, { defaultAgent: 'claude', reviewAfterDays: 30 });
    expect(await (await withClaude.request('/settings')).json()).toMatchObject({
      settings: { defaultAgent: 'codex' },
    });
  });

  it.each([
    ['開発用の fake', 'fake'],
    ['知らないエージェント', 'gemini'],
  ])('%s は 400 で保存しない', async (_, value) => {
    expect((await patch({ defaultAgent: value })).status).toBe(400);
    expect(repo.getAll()).toEqual({});
  });

  it('保存されている値が選べるエージェントでなければ、既定値として扱う', async () => {
    repo.setMany({ defaultAgent: '"fake"' });
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: { defaultAgent: 'claude', reviewAfterDays: 30 },
    });
  });
});

describe('FR-R06 設定「棚卸しの対象にする日数」', () => {
  it('0日（バックログのすべてが対象）を保存できる', async () => {
    expect((await patch({ reviewAfterDays: 0 })).status).toBe(200);
  });

  it('保存していなければ30日を返し、PATCH で変えた日数を保存する', async () => {
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: { reviewAfterDays: 30 },
    });
    expect((await patch({ reviewAfterDays: 14 })).status).toBe(200);
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: { reviewAfterDays: 14 },
    });
  });

  it.each([
    ['負の日数', -1],
    ['366日', 366],
    ['小数', 1.5],
    ['文字列', '30'],
  ])('%s は 400 で保存しない', async (_, value) => {
    expect((await patch({ reviewAfterDays: value })).status).toBe(400);
    expect(repo.getAll()).toEqual({});
  });
});

describe('FR-A07 偽のアダプタで動いていることを知らせる', () => {
  it('MYMIND_AGENT=fake で動いていれば、設定の応答で知らせる', async () => {
    const fake = createSettingsApi(repo, {}, { ...RUNTIME, fakeAgent: true });
    expect(await (await fake.request('/settings')).json()).toMatchObject({
      runtime: { fakeAgent: true },
    });
    const res = await fake.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAgent: 'codex' }),
    });
    expect(await res.json()).toMatchObject({ runtime: { fakeAgent: true } });
  });

  it('runtime は画面から変えられない', async () => {
    expect((await patch({ runtime: { fakeAgent: true } })).status).toBe(400);
  });
});

describe('NFR-04 設定「バックアップの保存先と世代数」', () => {
  it('保存していなければ、データディレクトリの中（null）と14世代を返す', async () => {
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: BACKUP_DEFAULTS,
    });
  });

  it('データディレクトリの外の絶対パスと世代数を保存し、null で初期の保存先に戻せる', async () => {
    expect(
      (await patch({ backupDir: '/Volumes/外付け/mymind', backupGenerations: 30 })).status,
    ).toBe(200);
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: { backupDir: '/Volumes/外付け/mymind', backupGenerations: 30 },
    });
    expect((await patch({ backupDir: null })).status).toBe(200);
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: { backupDir: null },
    });
  });

  it('保存先の前後の空白は除いて保存する', async () => {
    await patch({ backupDir: '  /tmp/backups ' });
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: { backupDir: '/tmp/backups' },
    });
  });

  it.each([
    ['相対パス', { backupDir: 'backups' }],
    ['空の保存先', { backupDir: '   ' }],
    ['0世代', { backupGenerations: 0 }],
    ['366世代', { backupGenerations: 366 }],
    ['小数の世代', { backupGenerations: 2.5 }],
  ])('%s は 400 で保存しない', async (_, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(repo.getAll()).toEqual({});
  });
});

describe('FR-N04 通知の設定', () => {
  it('保存していなければ、朝 8:30・夜 21:30・日曜 21:45 で、どれもオン', async () => {
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: {
        morningNotification: { enabled: true, time: '08:30' },
        eveningNotification: { enabled: true, time: '21:30' },
        inventoryNotification: { enabled: true, time: '21:45', weekday: 0 },
      },
    });
  });

  it('種類ごとにオン・オフと時刻（棚卸しは曜日も）を保存する', async () => {
    expect(
      (
        await patch({
          morningNotification: { enabled: false, time: '07:00' },
          inventoryNotification: { enabled: true, time: '20:00', weekday: 6 },
        })
      ).status,
    ).toBe(200);
    expect(await (await app.request('/settings')).json()).toMatchObject({
      settings: {
        morningNotification: { enabled: false, time: '07:00' },
        eveningNotification: { enabled: true, time: '21:30' },
        inventoryNotification: { enabled: true, time: '20:00', weekday: 6 },
      },
    });
  });

  it.each([
    ['24時', { eveningNotification: { enabled: true, time: '24:00' } }],
    ['分が60', { eveningNotification: { enabled: true, time: '21:60' } }],
    ['桁が足りない', { eveningNotification: { enabled: true, time: '9:30' } }],
    ['曜日が7', { inventoryNotification: { enabled: true, time: '21:45', weekday: 7 } }],
    ['曜日がない', { inventoryNotification: { enabled: true, time: '21:45' } }],
    ['毎日の通知に曜日', { morningNotification: { enabled: true, time: '08:30', weekday: 1 } }],
    ['オン・オフがない', { morningNotification: { time: '08:30' } }],
  ])('%s は 400 で保存しない', async (_, body) => {
    expect((await patch(body)).status).toBe(400);
    expect(repo.getAll()).toEqual({});
  });

  it('オフの種類は予定を持たず（null）、オンなら時刻と曜日を予定にする', () => {
    const read = createSettingsReader(repo);
    repo.setMany({ morningNotification: JSON.stringify({ enabled: false, time: '08:30' }) });
    expect(notificationScheduleOf(read(), 'morning')).toBeNull();
    expect(notificationScheduleOf(read(), 'evening')).toEqual({ time: '21:30' });
    expect(notificationScheduleOf(read(), 'inventory')).toEqual({ time: '21:45', weekday: 0 });
  });

  it('時刻やオン・オフを変えると、スケジューラの次の通知の時刻が変わる', async () => {
    // 2026-10-05（月）10:00（日本時間）
    const now = new Date('2026-10-05T01:00:00.000Z');
    const scheduler = createScheduler({
      now: () => now,
      timeZone: 'Asia/Tokyo',
      monotonic: () => now.getTime(),
      setTimer: (): TimerHandle => ({ cancel: () => {} }),
    });
    const read = createSettingsReader(repo);
    for (const kind of ['morning', 'evening', 'inventory'] as const) {
      scheduler.add({
        id: kind,
        spec: () => notificationScheduleOf(read(), kind),
        run: () => {},
      });
    }
    scheduler.start();
    const withReschedule = createSettingsApi(repo, {}, RUNTIME, () => scheduler.reschedule());
    const save = (body: unknown) =>
      withReschedule.request('/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(scheduler.nextRun('evening')).toEqual(new Date('2026-10-05T12:30:00.000Z'));
    expect(scheduler.nextRun('inventory')).toEqual(new Date('2026-10-11T12:45:00.000Z'));

    await save({ eveningNotification: { enabled: true, time: '22:15' } });
    expect(scheduler.nextRun('evening')).toEqual(new Date('2026-10-05T13:15:00.000Z'));

    await save({ inventoryNotification: { enabled: true, time: '09:00', weekday: 3 } });
    expect(scheduler.nextRun('inventory')).toEqual(new Date('2026-10-07T00:00:00.000Z'));

    await save({ morningNotification: { enabled: false, time: '08:30' } });
    expect(scheduler.nextRun('morning')).toBeNull();
  });
});
