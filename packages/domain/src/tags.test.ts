import { describe, expect, it } from 'vitest';
import { canAddTag, MAX_TAGS_PER_TASK, normalizeTagName, TAG_COLORS } from './tags';

describe('FR-T13 タグの名前', () => {
  it('前後の空白を除き、中の連続した空白を1つにする', () => {
    expect(normalizeTagName('  仕事   メール ')).toEqual({
      ok: true,
      value: { name: '仕事 メール', key: '仕事 メール' },
    });
  });

  it('重複の判定キーは、大文字・小文字と全角・半角を区別しない', () => {
    const a = normalizeTagName('Work');
    const b = normalizeTagName('ＷＯＲＫ');
    expect(a.ok && b.ok && a.value.key === b.value.key).toBe(true);
    // 表示する名前は入力のまま
    expect(b.ok && b.value.name).toBe('ＷＯＲＫ');
  });

  it('空の名前は作れない', () => {
    expect(normalizeTagName('   ')).toEqual({ ok: false, error: { kind: 'empty' } });
  });

  it('30文字までは作れ、31文字は作れない（絵文字も1文字と数える）', () => {
    expect(normalizeTagName('あ'.repeat(30)).ok).toBe(true);
    expect(normalizeTagName('あ'.repeat(31))).toEqual({
      ok: false,
      error: { kind: 'too_long', max: 30 },
    });
    expect(normalizeTagName('🍅'.repeat(30)).ok).toBe(true);
  });
});

describe('FR-T13 タグの数と色', () => {
  it('1つのタスクには10個まで付けられる', () => {
    expect(MAX_TAGS_PER_TASK).toBe(10);
    expect(canAddTag(9)).toBe(true);
    expect(canAddTag(10)).toBe(false);
  });

  it('色は6色', () => {
    expect(TAG_COLORS).toEqual(['rose', 'amber', 'green', 'teal', 'indigo', 'plum']);
  });
});
