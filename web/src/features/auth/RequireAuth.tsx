import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { authApi } from '../../api/auth';
import { Skeleton } from '../../design/Skeleton';
import { useSession } from './useSession';

/** Никакого обучающего тура в новом клиенте нет (в отличие от старого) —
 *  отметка «прошёл онбординг» здесь просто фиксирует, что человек один раз
 *  дошёл до рабочего экрана мимо смены пароля/выбора подразделений. */
function useMarkOnboardedOnce(onboarded: boolean | undefined) {
  const sent = useRef(false);
  useEffect(() => {
    if (onboarded === false && !sent.current) {
      sent.current = true;
      void authApi.markOnboarded().catch(() => { sent.current = false; });
    }
  }, [onboarded]);
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, data } = useSession();
  const loc = useLocation();
  useMarkOnboardedOnce(status === 'authed' ? data?.user.onboarded : undefined);

  if (status === 'loading') return <div style={{ padding: 16 }}><Skeleton lines={6} /></div>;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (data?.mustChangePassword && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (data?.needsAssignment && loc.pathname !== '/pending-assignment') return <Navigate to="/pending-assignment" replace />;
  if (data?.needsUnitPick && loc.pathname !== '/unit-pick') return <Navigate to="/unit-pick" replace />;
  return <>{children}</>;
}
