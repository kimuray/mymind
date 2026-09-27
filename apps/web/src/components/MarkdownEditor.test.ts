import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { wrapBold } from './MarkdownEditor';

const apply = (doc: string, from: number, to: number) => {
  const state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  const next = state.update(wrapBold(state)).state;
  return { doc: next.doc.toString(), from: next.selection.main.from, to: next.selection.main.to };
};

describe('FR-D06 Markdown の入力欄の太字（⌘B）', () => {
  it('選んだ範囲を ** で囲み、選んだ文字を選んだままにする', () => {
    expect(apply('今日は集中できた', 3, 7)).toEqual({
      doc: '今日は**集中でき**た',
      from: 5,
      to: 9,
    });
  });

  it('範囲を選んでいなければ、囲みの間にカーソルを置く', () => {
    expect(apply('あ', 1, 1)).toEqual({ doc: 'あ****', from: 3, to: 3 });
  });
});
