import { useEffect, useRef, useState } from 'react';
import type { ListTask } from '../api/tasks';
import { formatDateTime } from '../day';
import { useKeyBindings } from '../keyboard';
import { useTaskNoteDraft } from '../useTaskNoteDraft';
import { Button } from './Button';
import { MarkdownField, type MarkdownMode } from './MarkdownField';

/** 空のメモは「メモなし」（null）として保存する */
export const toNoteMd = (text: string): string | null => (text.trim() === '' ? null : text);

/**
 * タスクのメモ（FR-T09、DESIGN.md 4.21）。振り返りと同じ Markdown の欄で、書く／プレビューを ⌘P で切り替える。
 * 保存は、欄から抜けたときと、別のタスクを選んで欄が閉じるとき。保存のたびに履歴に「編集」が残るので、打つたびには保存しない。
 * 書きかけは1秒ごとに下書きへ残し、保存できたら消す（NFR-12）
 */
export function TaskMemo({
  task,
  onSave,
}: {
  task: ListTask;
  /** メモを保存する。失敗したら理由を投げる */
  onSave: (noteMd: string | null) => Promise<void>;
}) {
  const savedText = task.noteMd ?? '';
  const [text, setText] = useState(savedText);
  // 入力欄の最初の内容。下書きを復元したときや、ほかの画面で変わったときに作り直す
  const [initial, setInitial] = useState(savedText);
  const [editorVersion, setEditorVersion] = useState(0);
  const [mode, setMode] = useState<MarkdownMode>('write');
  const [status, setStatus] = useState('');
  const lastSaved = useRef(savedText);
  const latest = useRef({ text, onSave });
  latest.current = { text, onSave };
  const draft = useTaskNoteDraft({
    taskId: task.id,
    text,
    saved: { text: savedText, updatedAt: task.lastTouchedAt },
  });
  const clearSaved = useRef(draft.clearSaved);
  clearSaved.current = draft.clearSaved;

  // 保存中の内容。欄から抜けた直後に別のタスクを選ぶと、同じ内容を2回保存しようとするので重ねない
  const saving = useRef<string | null>(null);
  const save = async (text = latest.current.text) => {
    const current = text;
    if (current === lastSaved.current || current === saving.current) return;
    saving.current = current;
    try {
      await latest.current.onSave(toNoteMd(current));
      lastSaved.current = current;
      clearSaved.current(current);
      setStatus('保存しました');
    } catch (e) {
      // 下書きは残るので、次に開いたときに復元できる
      setStatus(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      saving.current = null;
    }
  };

  // ほかの画面で変わったとき、書きかけがなければ新しい内容にする
  useEffect(() => {
    if (savedText === lastSaved.current) return;
    if (latest.current.text !== lastSaved.current) return;
    lastSaved.current = savedText;
    setText(savedText);
    setInitial(savedText);
    setEditorVersion((v) => v + 1);
  }, [savedText]);

  // 別のタスクを選んで欄が閉じるとき、書きかけを保存する
  // biome-ignore lint/correctness/useExhaustiveDependencies: 閉じるときに一度だけ
  useEffect(
    () => () => {
      void save();
    },
    [],
  );

  // 欄から抜けたら保存する。欄の中で移っただけ（書く／プレビューの切り替えなど）なら保存しない
  const root = useRef<HTMLDivElement>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) void saveRef.current();
    };
    el.addEventListener('focusout', onFocusOut);
    return () => el.removeEventListener('focusout', onFocusOut);
  }, []);

  useKeyBindings({
    'reflection.togglePreview': () => {
      setMode((m) => (m === 'write' ? 'preview' : 'write'));
      return true;
    },
  });

  const restore = () => {
    if (draft.offer === null) return;
    setText(draft.offer.text);
    setInitial(draft.offer.text);
    setEditorVersion((v) => v + 1);
    draft.dismiss();
    // 復元は「この内容を残す」という選択なので、すぐに保存する
    void save(draft.offer.text);
  };

  return (
    <div className="task-memo" ref={root}>
      {draft.offer !== null && (
        <div className="draft-offer glass-2" role="status">
          <p>{`保存していないメモの下書きがあります（${formatDateTime(draft.offer.updatedAt)}）`}</p>
          <Button kind="text" onClick={restore}>
            復元する
          </Button>
          <Button kind="text" onClick={() => void draft.discard()}>
            破棄する
          </Button>
        </div>
      )}
      <MarkdownField
        key={`${task.id}-${editorVersion}`}
        id={`task-memo-${task.id}`}
        label="メモ"
        initialValue={initial}
        value={text}
        onChange={setText}
        mode={mode}
        onModeChange={setMode}
      />
      <p className="task-memo-status text-small" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
