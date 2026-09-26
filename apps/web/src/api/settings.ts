import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';

/** 画面から変えられる設定（GET / PATCH /api/settings） */
const fetchSettings = async () => unwrap(await api.settings.$get());

export type AppSettings = Awaited<ReturnType<typeof fetchSettings>>['settings'];

const settingsKey = ['settings'] as const;

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: fetchSettings });
}

/** 設定を変える。画面は mutation の値（variables）で先に表示を変え、保存の後に読み直す（ui.md の楽観的更新） */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>) =>
      unwrap(await api.settings.$patch({ json: patch })),
    onSuccess: (data) => qc.setQueryData(settingsKey, data),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKey }),
  });
}
