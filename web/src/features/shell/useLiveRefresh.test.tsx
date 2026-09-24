import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { authApi } from '../../api/auth';
import { useLiveRefresh } from './useLiveRefresh';

vi.mock('../../api/auth', () => ({ authApi: { liveSignature: vi.fn() } }));

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

test('первый опрос запоминает подпись, но не обновляет — иначе вход выглядел бы как изменение', async () => {
  vi.mocked(authApi.liveSignature).mockResolvedValue({ ok: true, sig: 'a', version: '1.0' });
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  renderHook(() => useLiveRefresh(), { wrapper: wrapper(qc) });

  await waitFor(() => expect(authApi.liveSignature).toHaveBeenCalled());
  expect(spy).not.toHaveBeenCalled();
});

test('изменившаяся подпись инвалидирует активные запросы', async () => {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  vi.mocked(authApi.liveSignature).mockResolvedValue({ ok: true, sig: 'a', version: '1.0' });
  renderHook(() => useLiveRefresh(), { wrapper: wrapper(qc) });
  await waitFor(() => expect(authApi.liveSignature).toHaveBeenCalled());
  expect(spy).not.toHaveBeenCalled();

  vi.mocked(authApi.liveSignature).mockResolvedValue({ ok: true, sig: 'b', version: '1.0' });
  document.dispatchEvent(new Event('visibilitychange'));

  await waitFor(() => expect(spy).toHaveBeenCalled());
});
