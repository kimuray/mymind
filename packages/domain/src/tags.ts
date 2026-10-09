/** タグの色（FR-T13）。DESIGN.md 2.8 のトークン（`--tag-<色>`）の名前 */
export const TAG_COLORS = ['rose', 'amber', 'green', 'teal', 'indigo', 'plum'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** 1つのタスクに付けられるタグの数（requirements.md 5章の暫定決定） */
export const MAX_TAGS_PER_TASK = 10;
/** タグの名前の長さの上限。チップに収まり、FB の入力（FR-A13）でも量が膨らまないように */
export const MAX_TAG_NAME_LENGTH = 30;

export type TagNameError = { kind: 'empty' } | { kind: 'too_long'; max: number };

/**
 * タグの名前を整える（requirements.md 5章）。前後の空白を除き、中の連続した空白は1つにする。
 * key は重複の判定に使う値で、全角・半角をそろえ（NFKC）、大文字・小文字を区別しない
 */
export function normalizeTagName(
  input: string,
): { ok: true; value: { name: string; key: string } } | { ok: false; error: TagNameError } {
  const name = input.trim().replace(/\s+/g, ' ');
  if (name === '') return { ok: false, error: { kind: 'empty' } };
  if ([...name].length > MAX_TAG_NAME_LENGTH) {
    return { ok: false, error: { kind: 'too_long', max: MAX_TAG_NAME_LENGTH } };
  }
  return { ok: true, value: { name, key: name.normalize('NFKC').toLowerCase() } };
}

/** タスクにもう1つタグを付けられるか */
export const canAddTag = (currentCount: number): boolean => currentCount < MAX_TAGS_PER_TASK;
