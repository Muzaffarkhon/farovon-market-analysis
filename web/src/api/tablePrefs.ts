import { request } from './client';

export const tablePrefsApi = {
  get: (tableKey: string) => request<{ ok: true; columns: string[] | null }>(`/table-prefs/${tableKey}`, undefined, { method: 'GET' }),
  save: (tableKey: string, columns: string[]) => request<{ ok: true; columns: string[] }>(`/table-prefs/${tableKey}`, { columns })
};
