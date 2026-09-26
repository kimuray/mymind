import { beforeEach, describe, expect, it } from 'vitest';
import { type Database, MIGRATIONS_FOLDER, openDatabase } from './client';
import { createSettingsRepository, type SettingsRepository } from './settingsRepository';

let db: Database;
let repo: SettingsRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  repo = createSettingsRepository({ db });
});

describe('FR-A12 設定の保存', () => {
  it('何も保存していなければ空を返す', () => {
    expect(repo.getAll()).toEqual({});
  });

  it('保存した値を読み出せ、同じ項目は上書きする', () => {
    repo.setMany({ confirmBeforeRequest: 'true', other: 'x' });
    repo.setMany({ confirmBeforeRequest: 'false' });
    expect(repo.getAll()).toEqual({ confirmBeforeRequest: 'false', other: 'x' });
  });
});
