import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { tablePrefsApi } from '../api/tablePrefs';

/**
 * Видимые колонки таблицы, свои для каждого пользователя, хранятся на
 * сервере (см. src/services/tablePrefsService.js) — переживают между
 * устройствами. Пока настройка не сохранена, видны все колонки по умолчанию.
 */
export function useTablePrefs(tableKey: string, allKeys: readonly string[]) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['table-prefs', tableKey], queryFn: () => tablePrefsApi.get(tableKey) });

  const saved = q.data?.columns;
  // Отфильтровано по allKeys — если колонка исчезла из экрана с прошлого
  // визита, её сохранённый ключ просто перестаёт что-либо значить.
  const visible = useMemo(() => {
    if (!saved || !saved.length) return new Set(allKeys);
    return new Set(allKeys.filter(k => saved.includes(k)));
  }, [saved, allKeys]);

  const save = useMutation({
    mutationFn: (columns: string[]) => tablePrefsApi.save(tableKey, columns),
    onSuccess: r => qc.setQueryData(['table-prefs', tableKey], { ok: true, columns: r.columns })
  });

  function toggle(key: string) {
    const next = visible.has(key) ? [...visible].filter(k => k !== key) : [...visible, key];
    if (next.length === 0) return; // хотя бы одна колонка должна остаться
    save.mutate(allKeys.filter(k => next.includes(k)));
  }

  return { visible, toggle, loading: q.isLoading };
}
