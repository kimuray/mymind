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
    expect(await res.json()).toEqual({ settings: { confirmBeforeRequest: false } });
  });

  it('PATCH で変えた値を保存し、GET で読み出せる', async () => {
    const res = await patch({ confirmBeforeRequest: true });
    expect(await res.json()).toEqual({ settings: { confirmBeforeRequest: true } });
    expect(await (await app.request('/settings')).json()).toEqual({
      settings: { confirmBeforeRequest: true },
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
      settings: { confirmBeforeRequest: false },
    });
    repo.setMany({ confirmBeforeRequest: '"true"' });
    expect(await (await app.request('/settings')).json()).toEqual({
      settings: { confirmBeforeRequest: false },
    });
  });
});
