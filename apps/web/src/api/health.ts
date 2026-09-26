import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * アプリの状態（NFR-21、GET /api/health）。
 * DB に問い合わせられないときも同じ形の本文が 503 で返るので、成功と同じように表示する
 */
const fetchHealth = async () => {
  const res = await api.health.$get();
  return res.json();
};

export type Health = Awaited<ReturnType<typeof fetchHealth>>;

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    // 状態は開いたときと「もう一度確かめる」で確かめる。エージェントの確認はコマンドを起動するので、勝手に繰り返さない
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
