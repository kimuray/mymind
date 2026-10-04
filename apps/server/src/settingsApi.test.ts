import { createSettingsRepository, MIGRATIONS_FOLDER, openDatabase } from '@mymind/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSettingsApi } from './settingsApi';

let app: ReturnType<typeof createSettingsApi>;
let repo: ReturnType<typeof createSettingsRepository>;

beforeEach(() => {
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  repo = createSettingsRepository({ db });
  app = createSettingsApi(repo);
});

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
      settings: { confirmBeforeRequest: false, defaultAgent: 'claude', reviewAfterDays: 30 },
    });
  });

  it('PATCH で変えた値を保存し、GET で読み出せる', async () => {
    const res = await patch({ confirmBeforeRequest: true });
    expect(await res.json()).toEqual({
      settings: { confirmBeforeRequest: true, defaultAgent: 'claude', reviewAfterDays: 30 },
    });
    expect(await (await app.request('/settings')).json()).toEqual({
      settings: { confirmBeforeRequest: true, defaultAgent: 'claude', reviewAfterDays: 30 },
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
      settings: { confirmBeforeRequest: false, defaultAgent: 'claude', reviewAfterDays: 30 },
    });
    repo.setMany({ confirmBeforeRequest: '"true"' });
    expect(await (await app.request('/settings')).json()).toEqual({
      settings: { confirmBeforeRequest: false, defaultAgent: 'claude', reviewAfterDays: 30 },
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
