import { request } from './client';
import type { CoordinationResponse, RemindResponse } from './contract';

export const coordinationApi = {
  get: () => request<CoordinationResponse>('/coordination'),
  remind: (logins: string[]) => request<RemindResponse>('/coordination/remind', { logins })
};
