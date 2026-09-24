import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../../api/admin';

export function useAuditLog() {
  const q = useQuery({ queryKey: ['audit-log'], queryFn: () => adminApi.auditLog(200) });
  return {
    logs: q.data?.logs ?? [],
    loading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
    fetching: q.isFetching
  };
}
