import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { registryApi } from '../../api/registry';
import type { RegistryFilters } from '../../api/contract';

/** Фильтры-значения: приходят из граней, хранятся в адресе как есть. */
export const PICKERS = [
  { key: 'dir', facet: 'dirs', label: 'Направление' },
  { key: 'unit', facet: 'units', label: 'Подразделение' },
  { key: 'region', facet: 'regions', label: 'Регион' },
  { key: 'company', facet: 'companies', label: 'Компания' },
  { key: 'grade', facet: 'grades', label: 'Грейд' },
  { key: 'schedule', facet: 'schedules', label: 'График' },
  { key: 'source', facet: 'sources', label: 'Источник' },
  { key: 'trust', facet: 'trusts', label: 'Надёжность' },
  { key: 'cur', facet: 'currencies', label: 'Валюта' },
  { key: 'hrbp', facet: 'hrbps', label: 'HR BP' }
] as const;

export type PickerKey = (typeof PICKERS)[number]['key'];

const FLAGS = ['onlyUnmapped', 'withPayOnly'] as const;

/** Сколько фильтров реально выбрано — число на кнопке «Фильтры». */
export function activeCount(f: RegistryFilters): number {
  let n = 0;
  for (const p of PICKERS) if (f[p.key]) n++;
  for (const k of FLAGS) if (f[k]) n++;
  if (f.search) n++;
  return n;
}

/**
 * Фильтры живут в адресе: ссылку на отфильтрованный реестр можно переслать,
 * «назад» возвращает предыдущий набор, F5 ничего не теряет.
 */
function fromParams(params: URLSearchParams): RegistryFilters {
  const out: RegistryFilters = {};
  for (const p of PICKERS) {
    const v = params.get(p.key);
    if (v) out[p.key] = v;
  }
  for (const k of FLAGS) if (params.get(k) === '1') out[k] = true;
  const search = params.get('q');
  if (search) out.search = search;
  const period = params.get('period');
  if (period) out.period = Number(period);
  out.sort = params.get('sort') || 'date';
  out.order = params.get('order') === 'asc' ? 'asc' : 'desc';
  out.page = Math.max(1, Number(params.get('page')) || 1);
  return out;
}

function intoParams(f: RegistryFilters, prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  // Период выбирается в шапке и к реестру отношения не имеет — сохраняем.
  const period = prev.get('period');
  if (period) next.set('period', period);
  for (const p of PICKERS) if (f[p.key]) next.set(p.key, String(f[p.key]));
  for (const k of FLAGS) if (f[k]) next.set(k, '1');
  if (f.search) next.set('q', f.search);
  if (f.sort && f.sort !== 'date') next.set('sort', f.sort);
  if (f.order === 'asc') next.set('order', 'asc');
  if (f.page && f.page > 1) next.set('page', String(f.page));
  return next;
}

export function useRegistry() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => fromParams(params), [params]);

  // Поле поиска отзывчиво само по себе, а запрос уходит с задержкой: иначе
  // каждая буква — обращение к серверу и мигание таблицы.
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  useEffect(() => { setSearchInput(filters.search ?? ''); }, [filters.search]);

  const patch = useCallback((next: Partial<RegistryFilters>, resetPage = true) => {
    setParams(prev => {
      const merged = { ...fromParams(prev), ...next };
      if (resetPage) merged.page = 1;
      return intoParams(merged, prev);
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    if (searchInput === (filters.search ?? '')) return;
    const t = setTimeout(() => patch({ search: searchInput || undefined }), 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.search, patch]);

  const reset = useCallback(() => {
    setParams(prev => {
      const next = new URLSearchParams();
      const period = prev.get('period');
      if (period) next.set('period', period);
      return next;
    }, { replace: true });
  }, [setParams]);

  /** Клик по заголовку: та же колонка — переворот порядка, другая — сверху вниз. */
  const sortBy = useCallback((key: string) => {
    patch(filters.sort === key
      ? { order: filters.order === 'asc' ? 'desc' : 'asc' }
      : { sort: key, order: 'desc' });
  }, [filters.sort, filters.order, patch]);

  const query = useQuery({
    queryKey: ['registry', filters],
    queryFn: () => registryApi.list(filters),
    placeholderData: keepPreviousData
  });

  return {
    filters, patch, reset, sortBy,
    searchInput, setSearchInput,
    active: activeCount(filters),
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null
  };
}
