import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastHost } from '../design/Toast';
import { SessionProvider } from '../features/auth/useSession';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } }
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
