import {
  canAddTag,
  MAX_TAGS_PER_TASK,
  normalizeTagName,
  TAG_COLORS,
  type TagColor,
} from '@mymind/domain';
import { useId, useState } from 'react';
import { ApiError } from '../api/client';
import { PENDING_TAG_PREFIX, tagKeyOf, useTags } from '../api/tags';
import type { ListTask } from '../api/tasks';
import { TAG_COLOR_LABELS, TagChip } from './TagChip';

/** 詳細ペインのタグの入力欄。リストの # キーでここへ移る（DESIGN.md 5.2） */
export const TASK_TAG_INPUT_ID = 'task-tag-input';

/** 付けられなかった理由。サーバーの判定をそのまま短く伝える */
function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'TOO_MANY_TAGS') return `タグは1つのタスクに${MAX_TAGS_PER_TASK}個までです`;
    if (e.code === 'VERSION_CONFLICT') return '別の画面で変更されていました。読み直しました';
    return e.message;
  }
  return 'タグを付けられませんでした';
}

/**
 * 詳細ペインのタグの欄（FR-T13、DESIGN.md 4.22）。付いているタグを外すボタン付きのチップで出し、
 * 入力欄に名前を打って Enter で付ける。既にあるタグは候補に出し、ない名前ならその場で作る（そのときだけ色を選ぶ）
 */
export function TaskTags({
  task,
  onAttach,
  onDetach,
}: {
  task: ListTask;
  /** 名前で付ける。ない名前ならその色で作る。失敗したら理由を投げる */
  onAttach: (name: string, color: TagColor) => Promise<void>;
  onDetach: (tagId: string) => void;
}) {
  const tags = useTags();
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>(TAG_COLORS[0]);
  const [message, setMessage] = useState('');
  const listId = useId();
  const colorName = useId();

  const attachedKeys = new Set(task.tags.map((t) => tagKeyOf(t.name)));
  const candidates = (tags.data?.tags ?? []).filter((t) => !attachedKeys.has(tagKeyOf(t.name)));
  const typedKey = tagKeyOf(name);
  const isNew =
    typedKey !== null && !(tags.data?.tags ?? []).some((t) => tagKeyOf(t.name) === typedKey);
  const isFull = !canAddTag(task.tags.length);

  const submit = async () => {
    const n = normalizeTagName(name);
    if (!n.ok) {
      setMessage(
        n.error.kind === 'empty'
          ? 'タグの名前を入れてください'
          : `タグの名前は${n.error.max}文字までです`,
      );
      return;
    }
    setName('');
    setColor(TAG_COLORS[0]);
    // 付いているタグは送らない（サーバーは何も変えないが、送ると画面の版の見込みがずれるため）
    if (attachedKeys.has(n.value.key)) {
      setMessage(`「${n.value.name}」は付いています`);
      return;
    }
    setMessage('');
    try {
      await onAttach(n.value.name, color);
    } catch (e) {
      setMessage(describeError(e));
    }
  };

  return (
    <section className="task-tags" aria-label="タグ">
      <h3 className="text-label">タグ</h3>
      {task.tags.length > 0 && (
        <ul className="tag-chips">
          {task.tags.map((t) => (
            <li key={t.id}>
              <TagChip
                name={t.name}
                color={t.color}
                // 保存が終わるまでは ID がないので外せない
                {...(t.id.startsWith(PENDING_TAG_PREFIX) ? {} : { onRemove: () => onDetach(t.id) })}
              />
            </li>
          ))}
        </ul>
      )}
      {isFull ? (
        <p className="text-small">
          タグは{MAX_TAGS_PER_TASK}個まで付けられます。外すと付けられます
        </p>
      ) : (
        <>
          <input
            id={TASK_TAG_INPUT_ID}
            className="task-tags-input"
            aria-label={`「${task.title}」にタグを付ける`}
            placeholder="タグを付ける（Enterで確定）"
            list={listId}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setMessage('');
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setName('');
                e.currentTarget.blur();
              }
            }}
          />
          <datalist id={listId}>
            {candidates.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          {isNew && (
            <fieldset className="tag-color-picker">
              <legend className="text-small">新しいタグ「{name.trim()}」の色</legend>
              {TAG_COLORS.map((c) => (
                <label key={c} className="tag-color-option" data-color={c}>
                  <input
                    type="radio"
                    name={colorName}
                    value={c}
                    checked={color === c}
                    onChange={() => setColor(c)}
                  />
                  <span className="tag-chip-dot" aria-hidden="true" />
                  <span className="visually-hidden">{TAG_COLOR_LABELS[c]}</span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
      <p className="text-small task-tags-message" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
