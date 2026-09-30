import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/600.css';
import '@fontsource/noto-sans-jp/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/client';
import { DAY_CHANGED_EVENT } from './dayGuard';
import { indexedDbDrafts } from './drafts';
import { router } from './router';

const queryClient = new QueryClient({
  // サーバーが業務日の不一致（409 DAY_CHANGED）を返したら、画面の業務日の確認に知らせる（NFR-14）
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'DAY_CHANGED') {
        window.dispatchEvent(new Event(DAY_CHANGED_EVENT));
      }
    },
  }),
});

// 30日を過ぎた下書きを起動時に消す（NFR-12、architecture.md 12.2）
indexedDbDrafts
  .prune(new Date())
  .catch((e: unknown) => console.warn('古い下書きを消せませんでした', e));

const root = document.getElementById('root');
if (root === null) throw new Error('#root が見つかりません');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
