import type { Status } from '@mymind/domain';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifyTasksChanged } from '../realtime';
import { api, unwrap } from './client';

type DayResponse = Awaited<ReturnType<typeof fetchDay>>;
/** 今日の計画とバックログに共通する行の型（今日の計画だけにある並び順 position は除く） */
export type ListTask = Omit<DayResponse['tasks'][number], 'position'>;
export type TaskEventJson = Awaited<ReturnType<typeof fetchEvents>>['events'][number];
export type Suggestion =
  | { kind: 'undo_auto_pause'; taskId: string }
  | { kind: 'complete_parent'; parentId: string };

const fetchDay = async (day: string) => unwrap(await api.days[':day'].$get({ param: { day } }));
const fetchEvents = async (id: string) =>
  unwrap(await api.tasks[':id'].events.$get({ param: { id } }));

export const queryKeys = {
  day: (day: string) => ['day', day] as const,
  backlog: ['backlog'] as const,
  events: (taskId: string) => ['events', taskId] as const,
};

export function useDayPlan(day: string) {
  return useQuery({
    queryKey: queryKeys.day(day),
    queryFn: () => fetchDay(day),
  });
}

export function useBacklog() {
  return useQuery({
    queryKey: queryKeys.backlog,
    queryFn: async () => unwrap(await api.backlog.$get()),
  });
}

export function useTaskEvents(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.events(taskId ?? ''),
    queryFn: () => fetchEvents(taskId ?? ''),
    enabled: taskId !== null,
  });
}

/**
 * タスクの一覧に関わるキャッシュをすべて読み直す（他の画面の表示も古くなるため）。
 * 他のタブにも知らせ、同じように読み直させる（NFR-13）
 */
const invalidateTasks = (qc: QueryClient) => {
  notifyTasksChanged();
  return reloadTasks(qc);
};

const reloadTasks = (qc: QueryClient) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: ['day'] }),
    qc.invalidateQueries({ queryKey: queryKeys.backlog }),
    qc.invalidateQueries({ queryKey: ['events'] }),
  ]);

/** 一覧のキャッシュの中のタスクを書き換える（楽観的更新。ui.md「即時に画面へ反映」） */
function patchCachedTask(qc: QueryClient, taskId: string, patch: Partial<ListTask>) {
  const apply = (old: { tasks: ListTask[] } | undefined) =>
    old === undefined
      ? old
      : { ...old, tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) };
  qc.setQueriesData<{ tasks: ListTask[] }>({ queryKey: ['day'] }, apply);
  qc.setQueryData<{ tasks: ListTask[] }>(queryKeys.backlog, apply);
}

type ScreenState = { expectedDay: string };

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ScreenState & {
        title: string;
        parentId?: string | null;
        planFor?: 'today' | 'tomorrow';
      },
    ) => unwrap(await api.tasks.$post({ json: input })),
    onSettled: () => invalidateTasks(qc),
  });
}

export function useTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScreenState & { task: ListTask; to: Status }) =>
      unwrap(
        await api.tasks[':id'].transition.$post({
          param: { id: input.task.id },
          json: {
            to: input.to,
            expectedVersion: input.task.version,
            expectedDay: input.expectedDay,
          },
        }),
      ),
    onMutate: async ({ task, to }) => {
      await qc.cancelQueries({ queryKey: ['day'] });
      await qc.cancelQueries({ queryKey: queryKeys.backlog });
      // サーバーは変更のたびに version を1つ上げる。続けて操作しても古い version で送らないよう、先に合わせる
      patchCachedTask(qc, task.id, { status: to, version: task.version + 1 });
    },
    // 失敗（別の画面で変更されていた、など）しても、成功しても、サーバーの状態を読み直す
    onSettled: () => invalidateTasks(qc),
  });
}

export function useMove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ScreenState & { task: ListTask; to: 'today' | 'tomorrow' | 'backlog' },
    ) =>
      unwrap(
        await api.tasks[':id'].move.$post({
          param: { id: input.task.id },
          json: {
            to: input.to,
            expectedVersion: input.task.version,
            expectedDay: input.expectedDay,
          },
        }),
      ),
    onSettled: () => invalidateTasks(qc),
  });
}

export function useEditTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: ScreenState & {
        task: ListTask;
        title?: string;
        parentId?: string | null;
        order?: { in: 'plan' | 'backlog'; value: number };
      },
    ) => {
      const { task, expectedDay, ...changes } = input;
      return unwrap(
        await api.tasks[':id'].$patch({
          param: { id: task.id },
          json: { ...changes, expectedVersion: task.version, expectedDay },
        }),
      );
    },
    onMutate: async ({ task, title }) => {
      if (title === undefined) return;
      await qc.cancelQueries({ queryKey: ['day'] });
      patchCachedTask(qc, task.id, { title, version: task.version + 1 });
    },
    onSettled: () => invalidateTasks(qc),
  });
}
