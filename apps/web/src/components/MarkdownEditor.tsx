import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { EDITOR_KEYS } from '../keymap';
import { readCspNonce } from '../session';

/** 画面の割り当て（保存してFBをもらう）と重なる、入力欄の既定のキー */
const RESERVED_KEYS = new Set(['Mod-Enter']);

/** 選んだ範囲を **…** で囲む変更。範囲がなければ、囲みの間にカーソルを置く */
export function wrapBold(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => ({
    changes: {
      from: range.from,
      to: range.to,
      insert: `**${state.sliceDoc(range.from, range.to)}**`,
    },
    range: EditorSelection.range(range.from + 2, range.to + 2),
  }));
}

const wrapSelectionInBold = (view: EditorView) => {
  view.dispatch(wrapBold(view.state));
  return true;
};

/**
 * Markdown の入力欄（DESIGN.md 4.7）。ガラスの面の中に CodeMirror 6 を置き、下端に書き方の案内を出す。
 * 値は最初の描画のときだけ受け取る（入力中に外から書き換えるとカーソルが飛ぶため）。
 * 別の内容で始め直すときは、呼び出す側で key を変える
 */
export function MarkdownEditor({
  label,
  initialValue,
  onChange,
}: {
  label: string;
  initialValue: string;
  onChange: (value: string) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 初期値は最初の描画でだけ使う（上の説明）
  useEffect(() => {
    if (parent.current === null) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          history(),
          keymap.of([
            { key: EDITOR_KEYS.bold, run: wrapSelectionInBold },
            ...defaultKeymap.filter((b) => b.key === undefined || !RESERVED_KEYS.has(b.key)),
            ...historyKeymap,
          ]),
          markdown(),
          // 入力欄の見た目の <style> を、本番の CSP のノンス付きで差し込む（ADR-0007）
          EditorView.cspNonce.of(readCspNonce() ?? ''),
          EditorView.lineWrapping,
          placeholderExt('一行だけでも大丈夫です'),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, [label]);

  return (
    <div className="markdown-editor glass-2">
      <div ref={parent} className="markdown-editor-body" />
      <p className="markdown-hints" aria-hidden="true">
        <span className="markdown-hints-title">Markdown</span>
        <span>## 見出し</span>
        <span>- リスト</span>
        <span>**太字**</span>
        <span>`コード`</span>
      </p>
    </div>
  );
}
