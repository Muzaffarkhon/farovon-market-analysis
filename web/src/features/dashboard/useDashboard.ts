import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { dashboardApi } from '../../api/dashboard';
import type { DashboardFilters } from '../../api/contract';
import { usePeriodId } from '../shell/usePeriodId';

export const TABS = [
  { key: 'overview', label: 'Обзор' },
  { key: 'salaries', label: 'Зарплатные вилки' },
  { key: 'regions', label: 'По регионам' },
  { key: 'benefits', label: 'Льготы и бонусы' },
  { key: 'benchmark', label: 'Бенчмаркинг' },
  { key: 'progress', label: 'Прогресс' }
] as const;

export type DashboardTab = (typeof TABS)[number]['key'];

const isTab = (v: string | undefined): v is DashboardTab => TABS.some(t => t.key === v);

const KEYS = ['dir', 'hrbp', 'region'] as const;

function fromParams(params: URLSearchParams, period: number | null): DashboardFilters {
  const out: DashboardFilters = { period };
  for (const k of KEYS) {
    const v = params.get(k);
    if (v) out[k] = v;
  }
  const search = params.get('q');
  if (search) out.search = search;
  return out;
}

/**
 * Вкладка — в пути (`/dashboard/:tab`, ссылку на конкретный разрез можно
 * переслать), фильтры направления/HR BP/региона/поиска — в query, период —
 * общий для всего приложения (`usePeriodId`, тот же, что у листа заполнения).
 */
export function useDashboard() {
  const params = useParams<{ tab?: string }>();
  const tab: DashboardTab = isTab(params.tab) ? params.tab : 'overview';

  const [searchParams, setSearchParams] = useSearchParams();
  const periodId = usePeriodId();
  const filters = useMemo(() => fromParams(searchParams, periodId), [searchParams, periodId]);

  const patch = useCallback((next: Partial<Omit<DashboardFilters, 'period'>>) => {
    setSearchParams(prev => {
      const merged = new URLSearchParams(prev);
      const apply = (key: string, value: string | undefined) => {
        if (value) merged.set(key, value); else merged.delete(key);
      };
      if ('dir' in next) apply('dir', next.dir);
      if ('hrbp' in next) apply('hrbp', next.hrbp);
      if ('region' in next) apply('region', next.region);
      if ('search' in next) apply('q', next.search);
      return merged;
    }, { replace: true });
  }, [setSearchParams]);

  const active = KEYS.filter(k => filters[k]).length + (filters.search ? 1 : 0);
  const reset = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);

  // Поле поиска отзывчиво само по себе, запрос уходит с задержкой — как в реестре.
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  useEffect(() => { setSearchInput(filters.search ?? ''); }, [filters.search]);
  useEffect(() => {
    if (searchInput === (filters.search ?? '')) return;
    const t = setTimeout(() => patch({ search: searchInput || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const query = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => dashboardApi.get(filters),
    placeholderData: keepPreviousData
  });

  return {
    tab, filters, patch, reset, active,
    searchInput, setSearchInput,
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null
  };
}
