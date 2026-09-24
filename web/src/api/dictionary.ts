import { request } from './client';
import type { DictKind, DictListResponse, SaveDictPayload, SaveDictResponse, DictUsageResponse, DictDeleteResponse } from './contract';

export const dictionaryApi = {
  list: (kind: DictKind) => request<DictListResponse>(`/admin/dictionary/${kind}`),
  usage: (kind: DictKind, name: string) => request<DictUsageResponse>(`/admin/dictionary/${kind}/usage?name=${encodeURIComponent(name)}`),
  save: (kind: DictKind, payload: SaveDictPayload) => request<SaveDictResponse>(`/admin/dictionary/${kind}`, payload),
  // Второй шаг подтверждённого удаления (см. useDictionary.remove) — сервер уже
  // предупреждён через usage(), поэтому здесь всегда confirm:true.
  remove: (kind: DictKind, name: string) => request<DictDeleteResponse>(`/admin/dictionary/${kind}/delete`, { name, confirm: true })
};
