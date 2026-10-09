import { normalizeTagName, type TagColor } from '@mymind/domain';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { invalidateTasks, type ListTask } from './tasks';

const fetchTags = async () => unwrap(await api.tags.$get());

/** タグ（FR-T13）。一覧では付いているタスクの数を添える */
export type TagWithCount = Awaited<ReturnType<typeof fetchTags>>['tags'][number];
export type TaskTag = ListTask['tags'][number];

export const tagsKey = ['tags'] as const;

/** 保存の前に画面に出す、まだ ID のないタグの仮の ID の頭 */
export const PENDING_TAG_PREFIX = 'pending:';

export function useTags() {
  return useQuery({ queryKey: tagsKey, queryFn: fetchTags });
}

/** 画面が想定している業務日（NFR-14）。前の日として続けると決めた画面では allowPastDay を付ける */
type ScreenState = { expectedDay: string; allowPastDay?: boolean };

/** タグの名前の重複を判定するキー（サーバーと同じ domain の関数で作る）。整えられない名前は null */
export const tagKeyOf = (name: string) => {
  const n = normalizeTagName(name);
  return n.ok ? n.value.key : null;
};

/**
 * 一覧のキャッシュの中のタスクのタグを書き換え、版を1つ進める（楽観的更新。ui.md「即時に画面へ反映」）。
 * タグが変わらないとき（付いているタグを付ける、など）はサーバーも版を進めないので、何もしない
 */
async function patchCachedTags(
  qc: QueryClient,
  task: ListTask,
  update: (tags: TaskTag[]) => TaskTag[],
) {
  await qc.cancelQueries({ queryKey: ['day'] });
  await qc.cancelQueries({ queryKey: ['backlog'] });
  const apply = (old: { tasks: ListTask[] } | undefined) =>
    old === undefined
      ? old
      : {
          ...old,
          tasks: old.tasks.map((t) => {
            if (t.id !== task.id) return t;
            const tags = update(t.tags);
            return tags === t.tags ? t : { ...t, tags, version: task.version + 1 };
          }),
        };
  qc.setQueriesData<{ tasks: ListTask[] }>({ queryKey: ['day'] }, apply);
  qc.setQueriesData<{ tasks: ListTask[] }>({ queryKey: ['backlog'] }, apply);
}

/** 名前の順（サーバーと同じく、大文字・小文字を区別しない） */
const byName = (a: TaskTag, b: TaskTag) =>
  a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' });

/**
 * タスクにタグを付ける。ない名前ならサーバーがその場で作る（FR-T13）。
 * 付け外しはタスクの属性の変更なので、版と業務日を送る（NFR-13、NFR-14）
 */
export function useAttachTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScreenState & { task: ListTask; name: string; color?: TagColor }) =>
      unwrap(
        await api.tasks[':id'].tags.$post({
          param: { id: input.task.id },
          json: {
            name: input.name,
            ...(input.color === undefined ? {} : { color: input.color }),
            expectedVersion: input.task.version,
            expectedDay: input.expectedDay,
            ...(input.allowPastDay === undefined ? {} : { allowPastDay: input.allowPastDay }),
          },
        }),
      ),
    onMutate: async ({ task, name, color }) => {
      // 既にあるタグなら、その色で先に出す。ない名前は、選んだ色で仮のタグとして出す
      const key = tagKeyOf(name);
      if (key === null) return;
      const known = qc
        .getQueryData<{ tags: TagWithCount[] }>(tagsKey)
        ?.tags.find((t) => tagKeyOf(t.name) === key);
      const tag: TaskTag = known
        ? { id: known.id, name: known.name, color: known.color }
        : { id: `${PENDING_TAG_PREFIX}${key}`, name: name.trim(), color: color ?? 'rose' };
      await patchCachedTags(qc, task, (tags) =>
        tags.some((t) => tagKeyOf(t.name) === key) ? tags : [...tags, tag].sort(byName),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: tagsKey });
      return invalidateTasks(qc);
    },
  });
}

export function useDetachTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScreenState & { task: ListTask; tagId: string }) =>
      unwrap(
        await api.tasks[':id'].tags[':tagId'].$delete({
          param: { id: input.task.id, tagId: input.tagId },
          json: {
            expectedVersion: input.task.version,
            expectedDay: input.expectedDay,
            ...(input.allowPastDay === undefined ? {} : { allowPastDay: input.allowPastDay }),
          },
        }),
      ),
    onMutate: ({ task, tagId }) =>
      patchCachedTags(qc, task, (tags) =>
        tags.some((t) => t.id === tagId) ? tags.filter((t) => t.id !== tagId) : tags,
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: tagsKey });
      return invalidateTasks(qc);
    },
  });
}
