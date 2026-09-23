import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { ToastHost } from '../design/Toast';
import { SessionProvider } from '../features/auth/useSession';

// 4xx (нет прав, не найдено, невалидный запрос) — тот же ответ и через
// секунду; повтор только откладывает показ ошибки пользователю без шанса
// на успех. Повторяем лишь то, что может быть временным сетевым сбоем.
function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false } }
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastHost>
        <SessionProvider>{children}</SessionProvider>
      </ToastHost>
    </QueryClientProvider>
  );
}
