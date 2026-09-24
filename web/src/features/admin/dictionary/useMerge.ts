import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maintenanceApi } from '../../../api/maintenance';
import { ApiError } from '../../../api/client';
import type { CompanyUsageResponse, PositionUsageResponse } from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export type MergeKind = 'companies' | 'positions';
export type MergeRow = {
  name: string; used: number; parts: string[]; inDictionary: boolean;
};

export function useMerge(kind: MergeKind) {
  const toast = useToast();
  const qc = useQueryClient();

  const usage = useQuery<CompanyUsageResponse | PositionUsageResponse>({
    queryKey: ['dictionary-merge-usage', kind],
    queryFn: () => (kind === 'companies' ? maintenanceApi.companyUsage() : maintenanceApi.positionUsage())
  });

  const similar = useQuery({
    queryKey: ['dictionary-merge-similar', kind],
    queryFn: () => maintenanceApi.similarNames(kind)
  });

  const data = usage.data;
  const rows: MergeRow[] = data
    ? 'companies' in data
      ? data.companies.map(c => ({
          name: c.name, used: c.total, inDictionary: c.inDictionary,
          parts: [c.competitors ? `${c.competitors} участников рынка` : '', c.surveys ? `${c.surveys} анкет` : ''].filter(Boolean)
        }))
      : data.positions.map(p => ({
          name: p.name, used: p.total, inDictionary: p.inDictionary,
          parts: [p.surveys ? `${p.surveys} анкет` : '', p.selections ? `${p.selections} выборов компаний` : '', p.unitPositions ? `${p.unitPositions} в штатке` : ''].filter(Boolean)
        }))
    : [];

  const merge = useMutation({
    mutationFn: (a: { keep: string; merge: string[] }) =>
      kind === 'companies' ? maintenanceApi.mergeCompanies(a.keep, a.merge) : maintenanceApi.mergePositions(a.keep, a.merge),
    onSuccess: r => {
      toast.show(r.message, 'ok');
      void qc.invalidateQueries({ queryKey: ['dictionary-merge-usage', kind] });
      void qc.invalidateQueries({ queryKey: ['dictionary-merge-similar', kind] });
      void qc.invalidateQueries({ queryKey: ['dictionary', kind] });
    },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось объединить', 'error')
  });

  return {
    rows, loading: usage.isLoading, error: usage.error as Error | null,
    pairs: similar.data?.pairs ?? [],
    merge: merge.mutate, merging: merge.isPending
  };
}
