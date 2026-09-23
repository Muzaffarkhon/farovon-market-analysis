import { request } from './client';
import type { RegistryFilters, RegistryResponse } from './contract';

export const registryApi = {
  list: (filters: RegistryFilters) => request<RegistryResponse>('/registry', filters)
};

/**
 * Выгрузка идёт обычной отправкой формы, а не fetch: файл собирает сервер,
 * и браузер сам покажет диалог сохранения. Через fetch пришлось бы держать
 * весь CSV в памяти и городить ссылку на blob.
 */
export function submitRegistryExport(filters: RegistryFilters) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/registry/export';
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = String(v);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
