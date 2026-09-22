import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from '../../api/auth';
import { setUnauthorizedHandler } from '../../api/client';
import type { SessionData } from '../../api/contract';

type State = { status: 'loading' | 'anon' | 'authed'; data?: SessionData };
type Ctx = State & {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setData: (d: SessionData) => void;
};

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const r = await authApi.resume();
      setState({ status: 'authed', data: r.data });
    } catch {
      setState({ status: 'anon' });
    }
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } finally { setState({ status: 'anon' }); }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ status: 'anon' }));
    void refresh();
  }, [refresh]);

  const value = useMemo<Ctx>(() => ({
    ...state, refresh, logout,
    setData: d => setState({ status: 'authed', data: d })
  }), [state, refresh, logout]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession вне SessionProvider');
  return ctx;
}

/** Данные сессии для экранов, которые рендерятся только под RequireAuth. */
export function useSessionData(): SessionData {
  const { data } = useSession();
  if (!data) throw new Error('Нет данных сессии');
  return data;
}
