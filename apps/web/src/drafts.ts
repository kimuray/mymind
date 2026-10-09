// 書きかけの下書き（NFR-12、architecture.md 12.2）。入力が止まってから1秒後にブラウザの IndexedDB に残し、
// 保存 API が成功したら消す。サーバーが止まっていても、タブを閉じても、次に開いたときに復元を尋ねられる。
// 下書きもブラウザ内に残る機微データなので、30日を過ぎたものは起動時に消す

/** 入力が止まってから下書きを書き込むまでの時間 */
export const DRAFT_DELAY_MS = 1000;
/** 下書きを残しておく日数 */
export const DRAFT_KEEP_DAYS = 30;

export type Draft = { key: string; text: string; updatedAt: string };

export type ReflectionField = 'thoughts' | 'learning';

/** 振り返りの下書きのキー（architecture.md 12.2 の `reflection:<業務日>:<項目>`） */
export const reflectionDraftKey = (day: string, field: ReflectionField) =>
  `reflection:${day}:${field}`;

/** タスクのメモの下書きのキー（architecture.md 12.2、FR-T09） */
export const taskNoteDraftKey = (taskId: string) => `task-note:${taskId}`;

/**
 * 画面を開いたときに、復元を尋ねる下書きか。
 * サーバーに保存した後に書き足した（保存した時刻より新しい）下書きで、中身が保存した内容と違うものだけを尋ねる
 */
export function isRestorable(
  draft: Draft | undefined,
  saved: { text: string; updatedAt: string | null },
): draft is Draft {
  if (draft === undefined || draft.text === saved.text) return false;
  return saved.updatedAt === null || draft.updatedAt > saved.updatedAt;
}

/** 起動時に消す下書き（最後に書き込んでから30日を過ぎたもの） */
export function expiredDraftKeys(drafts: readonly Draft[], now: Date): string[] {
  const limit = new Date(now.getTime() - DRAFT_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return drafts.filter((d) => d.updatedAt < limit).map((d) => d.key);
}

export type DraftStore = {
  get(key: string): Promise<Draft | undefined>;
  put(draft: Draft): Promise<void>;
  /** 下書きが保存した内容と同じなら消す（保存の後に書き足した分は残す） */
  deleteIfSaved(key: string, savedText: string): Promise<void>;
  /** 期限を過ぎた下書きを消し、消したキーを返す */
  prune(now: Date): Promise<string[]>;
};

const DB_NAME = 'mymind';
const STORE = 'drafts';

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

let opening: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> => run((await openDb()).transaction(STORE, mode).objectStore(STORE));

/** ブラウザの IndexedDB に置く下書き */
export const indexedDbDrafts: DraftStore = {
  get: (key) => withStore('readonly', (s) => request(s.get(key) as IDBRequest<Draft | undefined>)),
  put: (draft) => withStore('readwrite', async (s) => void (await request(s.put(draft)))),
  deleteIfSaved: (key, savedText) =>
    withStore('readwrite', async (s) => {
      const current = (await request(s.get(key))) as Draft | undefined;
      if (current?.text === savedText) await request(s.delete(key));
    }),
  prune: (now) =>
    withStore('readwrite', async (s) => {
      const keys = expiredDraftKeys((await request(s.getAll())) as Draft[], now);
      for (const key of keys) await request(s.delete(key));
      return keys;
    }),
};
