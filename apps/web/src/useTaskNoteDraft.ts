import { useEffect, useRef, useState } from 'react';
import {
  DRAFT_DELAY_MS,
  type Draft,
  type DraftStore,
  indexedDbDrafts,
  isRestorable,
  taskNoteDraftKey,
} from './drafts';

/**
 * タスクのメモの下書き（FR-T09、NFR-12）。振り返りの下書き（useReflectionDrafts）と同じく、
 * 入力が止まってから1秒後に IndexedDB に書き、保存できたら消す。
 * メモの欄を開いたときに、保存した内容より新しい下書きがあれば offer で知らせる
 */
export function useTaskNoteDraft({
  taskId,
  text,
  saved,
  store = indexedDbDrafts,
}: {
  taskId: string;
  /** 欄の今の内容 */
  text: string;
  /** 保存してある内容と、そのタスクに最後に触れた時刻 */
  saved: { text: string; updatedAt: string };
  store?: DraftStore;
}) {
  const [offer, setOffer] = useState<Draft | null>(null);
  // 下書きに書いた（または保存済みで、書く必要のない）内容
  const written = useRef(saved.text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 待っている書き込みの内容（なければ null）
  const pending = useRef<string | null>(null);
  const key = taskNoteDraftKey(taskId);

  const cancelTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  };

  const write = (value: string) => {
    cancelTimer();
    if (value === written.current) return;
    written.current = value;
    store
      .put({ key, text: value, updatedAt: new Date().toISOString() })
      .catch((e: unknown) => console.warn('メモの下書きを残せませんでした', e));
  };

  // 欄を開いたときだけ、残っている下書きを確かめる
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いた時点の保存済みの内容と比べる
  useEffect(() => {
    let cancelled = false;
    store
      .get(key)
      .then((draft) => {
        if (!cancelled && isRestorable(draft, saved)) setOffer(draft);
      })
      .catch((e: unknown) => console.warn('メモの下書きを読み込めませんでした', e));
    return () => {
      cancelled = true;
    };
  }, [key]);

  // 入力が止まってから1秒後に書き込む
  // biome-ignore lint/correctness/useExhaustiveDependencies: 内容が変わったときだけ書く
  useEffect(() => {
    if (text === written.current) return;
    cancelTimer();
    pending.current = text;
    timer.current = setTimeout(() => write(text), DRAFT_DELAY_MS);
    return cancelTimer;
  }, [text]);

  return {
    offer,
    /**
     * 1秒を待たずに、今の内容を下書きに書く。欄が閉じるときと保存に失敗したときに呼ぶ
     * （待っている間に欄が閉じたり、サーバーに届かなかったりしても、書きかけを失わないため）
     */
    flush: (value: string) => write(value),
    /**
     * 保存できた。待っている書き込みを取り消し、保存した内容と同じ下書きを消す
     * （取り消さないと、消したあとで同じ内容をまた書いてしまう）。保存の後に書き足した分は残す
     */
    markSaved: (savedText: string) => {
      if (pending.current === savedText) cancelTimer();
      written.current = savedText;
      store
        .deleteIfSaved(key, savedText)
        .catch((e: unknown) => console.warn('メモの下書きを消せませんでした', e));
    },
    /** 復元しない。尋ねた下書きを消してから知らせを閉じる */
    discard: async () => {
      if (offer === null) return;
      try {
        await store.deleteIfSaved(key, offer.text);
      } catch (e) {
        console.warn('メモの下書きを消せませんでした', e);
      }
      setOffer(null);
    },
    dismiss: () => setOffer(null),
  };
}
