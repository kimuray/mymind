import { useEffect, useRef, useState } from 'react';
import type { ReflectionDraft } from './api/reflection';
import {
  DRAFT_DELAY_MS,
  type Draft,
  type DraftStore,
  indexedDbDrafts,
  isRestorable,
  type ReflectionField,
  reflectionDraftKey,
} from './drafts';

type FieldKey = keyof ReflectionDraft;
const FIELD_NAMES: Record<FieldKey, ReflectionField> = {
  thoughtsMd: 'thoughts',
  learningMd: 'learning',
};
const FIELD_KEYS = Object.keys(FIELD_NAMES) as FieldKey[];

/** 復元を尋ねる下書き。欄ごとに、下書きがなければ undefined */
export type DraftOffer = { drafts: Partial<Record<FieldKey, Draft>>; updatedAt: string };

/**
 * 振り返りの下書き（NFR-12）。入力が止まってから1秒後に IndexedDB に書き、保存できたら消す。
 * 画面を開いたときに、保存した内容より新しい下書きがあれば offer で知らせる。
 * IndexedDB が使えない（プライベートブラウズなど）ときは、下書きを残さずに入力だけを続けられるようにする
 */
export function useReflectionDrafts({
  day,
  draft,
  saved,
  store = indexedDbDrafts,
}: {
  day: string;
  draft: ReflectionDraft;
  saved: ReflectionDraft & { updatedAt: string | null };
  store?: DraftStore;
}) {
  const [offer, setOffer] = useState<DraftOffer | null>(null);
  const written = useRef<ReflectionDraft>(saved);
  const key = (field: FieldKey) => reflectionDraftKey(day, FIELD_NAMES[field]);

  // 画面を開いたときだけ、残っている下書きを確かめる
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いた時点の保存済みの内容と比べる
  useEffect(() => {
    let cancelled = false;
    void Promise.all(FIELD_KEYS.map((f) => store.get(key(f))))
      .then((found) => {
        if (cancelled) return;
        const drafts: DraftOffer['drafts'] = {};
        FIELD_KEYS.forEach((f, i) => {
          const d = found[i];
          if (isRestorable(d, { text: saved[f], updatedAt: saved.updatedAt })) drafts[f] = d;
        });
        const times = Object.values(drafts).map((d) => d.updatedAt);
        if (times.length > 0) setOffer({ drafts, updatedAt: times.sort().at(-1) ?? '' });
      })
      .catch((e: unknown) => console.warn('下書きを読み込めませんでした', e));
    return () => {
      cancelled = true;
    };
  }, [day]);

  // 入力が止まってから1秒後に、変わった欄だけを書き込む
  // biome-ignore lint/correctness/useExhaustiveDependencies: 欄の内容が変わったときだけ書く
  useEffect(() => {
    const timer = setTimeout(() => {
      const at = new Date().toISOString();
      for (const f of FIELD_KEYS) {
        if (draft[f] === written.current[f]) continue;
        written.current = { ...written.current, [f]: draft[f] };
        store
          .put({ key: key(f), text: draft[f], updatedAt: at })
          .catch((e: unknown) => console.warn('下書きを残せませんでした', e));
      }
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft.thoughtsMd, draft.learningMd]);

  /** 保存できた内容と同じ下書きを消す（保存の後に書き足した分は残す） */
  const clearSaved = (savedDraft: ReflectionDraft) => {
    for (const f of FIELD_KEYS) {
      store
        .deleteIfSaved(key(f), savedDraft[f])
        .catch((e: unknown) => console.warn('下書きを消せませんでした', e));
    }
  };

  /** 復元しない。尋ねた下書きを消し終えてから知らせを閉じる（すぐ閉じると、直後に閉じたタブで消し損ねる） */
  const discard = async () => {
    if (offer === null) return;
    try {
      await Promise.all(
        Object.entries(offer.drafts).map(([f, d]) =>
          store.deleteIfSaved(key(f as FieldKey), d.text),
        ),
      );
    } catch (e) {
      console.warn('下書きを消せませんでした', e);
    }
    setOffer(null);
  };

  return { offer, clearSaved, discard, dismiss: () => setOffer(null) };
}
