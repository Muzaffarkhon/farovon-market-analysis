import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Skeleton } from '../../design/Skeleton';
import { useSession } from './useSession';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, data } = useSession();
  const loc = useLocation();
  if (status === 'loading') return <div style={{ padding: 16 }}><Skeleton lines={6} /></div>;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (data?.mustChangePassword && loc.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}
