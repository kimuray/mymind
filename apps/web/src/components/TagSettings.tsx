import { normalizeTagName, TAG_COLORS, type TagColor } from '@mymind/domain';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { type TagWithCount, useDeleteTag, useTags, useUpdateTag } from '../api/tags';
import { Button } from './Button';
import { Loading } from './Loading';
import { TAG_COLOR_LABELS, TagChip } from './TagChip';

/** 変えられなかった理由。重複はサーバーの判定をそのまま伝える */
const describeError = (e: unknown) =>
  e instanceof ApiError ? e.message : 'タグを変えられませんでした';

/**
 * 1つのタグの行。名前は入力を終えたとき（フォーカスを外す、Enter）に保存し、Esc で元に戻す。
 * 色は丸を選んだときに保存する。削除は、外れるタスクの数を示して確かめてから行う
 */
function TagRow({ tag }: { tag: TagWithCount }) {
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [name, setName] = useState(tag.name);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  // ほかの画面やこの行での保存で名前が変わったら、入力欄をその名前にそろえる
  const [seenName, setSeenName] = useState(tag.name);
  if (seenName !== tag.name) {
    setSeenName(tag.name);
    setName(tag.name);
  }
  // 保存を待たずに選んだ色を出す（ui.md の楽観的更新）
  const [chosenColor, setChosenColor] = useState<TagColor | null>(null);
  // 選んだ色が読み直した値に届いたら、選んだ値を手放す
  if (chosenColor !== null && chosenColor === tag.color) setChosenColor(null);
  const color = chosenColor ?? tag.color;

  const saveName = () => {
    const n = normalizeTagName(name);
    if (!n.ok) {
      setMessage(
        n.error.kind === 'empty'
          ? 'タグの名前を入れてください'
          : `タグの名前は${n.error.max}文字までです`,
      );
      return;
    }
    setName(n.value.name);
    if (n.value.name === tag.name) {
      setMessage('');
      return;
    }
    update.mutate(
      { id: tag.id, name: n.value.name },
      {
        onSuccess: () => setMessage('保存しました'),
        onError: (e) => setMessage(describeError(e)),
      },
    );
  };

  return (
    <li className="tag-settings-row" data-color={color}>
      <TagChip name={tag.name} color={color} />
      <input
        className="tag-settings-name"
        aria-label={`「${tag.name}」の名前`}
        value={name}
        aria-invalid={message !== '' && message !== '保存しました'}
        onChange={(e) => {
          setName(e.target.value);
          setMessage('');
        }}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            saveName();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setName(tag.name);
            setMessage('');
          }
        }}
      />
      <fieldset className="tag-color-picker tag-settings-colors">
        <legend className="visually-hidden">「{tag.name}」の色</legend>
        {TAG_COLORS.map((c) => (
          <label key={c} className="tag-color-option" data-color={c}>
            <input
              type="radio"
              name={`tag-color-${tag.id}`}
              value={c}
              checked={color === c}
              onChange={() => {
                setChosenColor(c);
                update.mutate(
                  { id: tag.id, color: c },
                  {
                    onError: (e) => {
                      setChosenColor(null);
                      setMessage(describeError(e));
                    },
                  },
                );
              }}
            />
            <span className="tag-chip-dot" aria-hidden="true" />
            <span className="visually-hidden">{TAG_COLOR_LABELS[c]}</span>
          </label>
        ))}
      </fieldset>
      <span className="tag-settings-count">{tag.taskCount}件のタスク</span>
      {confirming ? (
        <span className="tag-settings-confirm">
          <span role="alert">
            {tag.taskCount > 0
              ? `削除すると、付いている${tag.taskCount}件のタスクから外れます`
              : '削除します'}
          </span>
          <Button
            kind="confirm"
            busy={remove.isPending}
            onClick={() =>
              remove.mutate(tag.id, {
                onError: (e) => {
                  setConfirming(false);
                  setMessage(describeError(e));
                },
              })
            }
          >
            削除する
          </Button>
          {/* biome-ignore lint/a11y/noAutofocus: 取り消しにくい操作なので、確かめるときは「やめる」にフォーカスを置く */}
          <Button autoFocus onClick={() => setConfirming(false)}>
            やめる
          </Button>
        </span>
      ) : (
        <Button
          kind="text"
          aria-label={`「${tag.name}」を削除`}
          onClick={() => setConfirming(true)}
        >
          削除
        </Button>
      )}
      <p className="settings-note tag-settings-message" aria-live="polite">
        {message}
      </p>
    </li>
  );
}

/** 設定の「タグ」（FR-T13、DESIGN.md 4.10）。タグの名前と色を変え、削除する */
export function TagSettings() {
  const tags = useTags();
  const list = tags.data?.tags ?? [];
  return (
    <section className="task-list settings-status glass-2" aria-label="タグ">
      <div className="settings-status-head">
        <h2>タグ</h2>
      </div>
      {tags.isPending && <Loading />}
      {tags.isSuccess && list.length === 0 ? (
        <p className="settings-note tag-settings-empty">
          タグはまだありません。タスクの詳細ペインで付けると、ここに並びます
        </p>
      ) : (
        <ul className="tag-settings-list">
          {list.map((tag) => (
            <TagRow key={tag.id} tag={tag} />
          ))}
        </ul>
      )}
    </section>
  );
}
