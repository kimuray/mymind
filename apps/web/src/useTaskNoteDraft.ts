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
  const written = useRef(saved.text);
  const key = taskNoteDraftKey(taskId);

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
    const timer = setTimeout(() => {
      written.current = text;
      store
        .put({ key, text, updatedAt: new Date().toISOString() })
        .catch((e: unknown) => console.warn('メモの下書きを残せませんでした', e));
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return {
    offer,
    /** 保存できた内容と同じ下書きを消す（保存の後に書き足した分は残す） */
    clearSaved: (savedText: string) => {
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
