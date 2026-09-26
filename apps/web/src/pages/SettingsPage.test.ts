import { describe, expect, it } from 'vitest';
import { formatBytes, formatDateTime } from './SettingsPage';

describe('NFR-21 設定画面の表示', () => {
  it('DB のサイズを読みやすい単位にする', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });

  it('日時は業務日と同じタイムゾーン（Asia/Tokyo）で「9月25日 16:53」の形にする', () => {
    expect(formatDateTime('2026-09-25T07:53:24.000Z')).toBe('9月25日 16:53');
    // 日本時間では翌日になる時刻
    expect(formatDateTime('2026-12-31T15:05:00.000Z')).toBe('1月1日 00:05');
  });
});
