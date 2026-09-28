import { describe, expect, it } from 'vitest';
import { expiredDraftKeys, isRestorable, reflectionDraftKey } from './drafts';

describe('NFR-12 下書きの復元', () => {
  const draft = {
    key: 'reflection:2026-09-27:thoughts',
    text: '書きかけ',
    updatedAt: '2026-09-27T12:00:01.000Z',
  };

  it('キーは業務日と項目を含む', () => {
    expect(reflectionDraftKey('2026-09-27', 'learning')).toBe('reflection:2026-09-27:learning');
  });

  it('まだ一度も保存していない日の下書きは、復元を尋ねる', () => {
    expect(isRestorable(draft, { text: '', updatedAt: null })).toBe(true);
  });

  it('保存した時刻より新しく、中身が違う下書きは、復元を尋ねる', () => {
    expect(
      isRestorable(draft, { text: '保存した内容', updatedAt: '2026-09-27T12:00:00.000Z' }),
    ).toBe(true);
  });

  it('保存した時刻より古い下書きは尋ねない（別の画面で保存し直した場合など）', () => {
    expect(
      isRestorable(draft, { text: '保存した内容', updatedAt: '2026-09-27T12:00:02.000Z' }),
    ).toBe(false);
  });

  it('中身が保存した内容と同じ下書きや、下書きがない場合は尋ねない', () => {
    expect(isRestorable(draft, { text: '書きかけ', updatedAt: null })).toBe(false);
    expect(isRestorable(undefined, { text: '', updatedAt: null })).toBe(false);
  });
});

describe('NFR-12 下書きの期限', () => {
  const at = (updatedAt: string) => ({ key: updatedAt, text: 'x', updatedAt });
  const now = new Date('2026-10-27T12:00:00.000Z');

  it('最後に書き込んでから30日を過ぎた下書きだけを消す', () => {
    expect(
      expiredDraftKeys(
        [
          at('2026-09-27T11:59:59.999Z'),
          at('2026-09-27T12:00:00.000Z'),
          at('2026-10-27T00:00:00.000Z'),
        ],
        now,
      ),
    ).toEqual(['2026-09-27T11:59:59.999Z']);
  });
});
