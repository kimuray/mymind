import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, openDatabase } from './client';
import {
  createNotificationRepository,
  type NotificationRepository,
} from './notificationRepository';

let repo: NotificationRepository;
beforeEach(() => {
  const db = openDatabase({ path: ':memory:', migrationsFolder: MIGRATIONS_FOLDER });
  repo = createNotificationRepository({ db });
});

const AT = '2026-10-04T23:30:00.000Z';

describe('FR-N04 送った通知の記録', () => {
  it('同じ種類・同じ業務日は、2回目を記録しない', () => {
    expect(repo.claim('morning', '2026-10-05', AT)).toBe(true);
    expect(repo.claim('morning', '2026-10-05', AT)).toBe(false);
    expect(repo.wasSent('morning', '2026-10-05')).toBe(true);
  });

  it('種類か業務日が違えば、別の通知として記録する', () => {
    expect(repo.claim('morning', '2026-10-05', AT)).toBe(true);
    expect(repo.claim('evening', '2026-10-05', AT)).toBe(true);
    expect(repo.claim('morning', '2026-10-06', AT)).toBe(true);
  });

  it('送れなかった通知の記録を消すと、また送れる', () => {
    repo.claim('inventory', '2026-10-04', AT);
    repo.release('inventory', '2026-10-04');
    expect(repo.wasSent('inventory', '2026-10-04')).toBe(false);
    expect(repo.claim('inventory', '2026-10-04', AT)).toBe(true);
  });
});
