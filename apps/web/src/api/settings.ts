import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifySettingsChanged } from '../realtime';
import { api, unwrap } from './client';

/** 画面から変えられる設定（GET / PATCH /api/settings） */
const fetchSettings = async () => unwrap(await api.settings.$get());

export type AppSettings = Awaited<ReturnType<typeof fetchSettings>>['settings'];

/** FB を書くエージェント（FR-A07） */
export type AgentChoice = AppSettings['defaultAgent'];

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
    onSuccess: (data) => {
      qc.setQueryData(settingsKey, data);
      notifySettingsChanged();
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: settingsKey });
      // 棚卸しの日数（FR-R06）で対象が変わる
      qc.invalidateQueries({ queryKey: ['review'] });
    },
  });
}
