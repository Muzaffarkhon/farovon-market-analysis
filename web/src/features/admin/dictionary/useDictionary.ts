import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dictionaryApi } from '../../../api/dictionary';
import { ApiError } from '../../../api/client';
import type { DictKind, SaveDictPayload } from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export function useDictionary(kind: DictKind) {
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['dictionary', kind];

  const list = useQuery({ queryKey: key, queryFn: () => dictionaryApi.list(kind) });

  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: (payload: SaveDictPayload) => dictionaryApi.save(kind, payload),
    onSuccess: (_r, payload) => { toast.show(payload.prev ? 'Изменено' : 'Добавлено в справочник', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error')
  });

  // Удаление — сначала считаем объём использования (usage), подтверждение
  // показывает вызывающий компонент; сам remove() уже безусловный (confirm:true).
  const remove = useMutation({
    mutationFn: (name: string) => dictionaryApi.remove(kind, name),
    onSuccess: r => { toast.show('Удалено' + (r.total ? `, затронуто: ${r.parts.join(', ')}` : ''), 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить', 'error')
  });

  return {
    items: list.data?.items, dirs: list.data?.dirs ?? [], loading: list.isLoading, error: list.error as Error | null,
    usage: (name: string) => dictionaryApi.usage(kind, name),
    save: save.mutate, saving: save.isPending,
    remove: remove.mutate, removing: remove.isPending
  };
}
