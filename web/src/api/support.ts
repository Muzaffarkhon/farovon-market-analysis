import { request } from './client';
import type {
  OkResponse, SupportFilters, SupportThreadsResponse, SupportThreadResponse,
  SupportQuickRepliesResponse, SaveQuickReplyPayload, SupportFaqResponse, SaveFaqPayload,
  LinkEmployeeResponse,
  MySupportThreadsResponse, MySupportThreadResponse, MySupportStartResponse, MySupportUnreadResponse
} from './contract';

function qs(params: Record<string, string | undefined>) {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) s.set(k, v); });
  const str = s.toString();
  return str ? '?' + str : '';
}

export const supportApi = {
  // Сотрудник — свои обращения
  myThreads: () => request<MySupportThreadsResponse>('/support/my/threads'),
  myThread: (id: number) => request<MySupportThreadResponse>(`/support/my/threads/${id}`),
  start: (topic: string, text: string) => request<MySupportStartResponse>('/support/my/start', { topic, text }),
  reply: (threadId: number, text: string) => request<OkResponse>('/support/my/reply', { thread_id: threadId, text }),
  myUnreadCount: () => request<MySupportUnreadResponse>('/support/my/unread-count'),
  faq: () => request<SupportFaqResponse>('/support/faq'),

  // Админка — инбокс
  adminThreads: (filters: SupportFilters) => request<SupportThreadsResponse>('/admin/support/threads' + qs({ ...filters })),
  adminThread: (id: number) => request<SupportThreadResponse>(`/admin/support/threads/${id}`),
  adminReply: (threadId: number, text: string) => request<OkResponse>('/admin/support/reply', { thread_id: threadId, text }),
  close: (threadId: number) => request<OkResponse>('/admin/support/close', { thread_id: threadId }),
  archive: (threadId: number) => request<OkResponse>('/admin/support/archive', { thread_id: threadId }),
  unarchive: (threadId: number) => request<OkResponse>('/admin/support/unarchive', { thread_id: threadId }),
  remove: (threadId: number) => request<OkResponse>('/admin/support/delete', { thread_id: threadId }),
  linkEmployee: (threadId: number, userId: number) =>
    request<LinkEmployeeResponse>('/admin/support/link-employee', { thread_id: threadId, user_id: userId }),

  quickReplies: (audience: 'admin' | 'guest') =>
    request<SupportQuickRepliesResponse>('/admin/support/quick-replies' + qs({ audience })),
  saveQuickReply: (payload: SaveQuickReplyPayload) => request<{ ok: true; id: number }>('/admin/support/quick-replies', payload),
  deleteQuickReply: (id: number) => request<OkResponse>('/admin/support/quick-replies/delete', { id }),

  saveFaq: (payload: SaveFaqPayload) => request<{ ok: true; id: number }>('/admin/support/faq', payload),
  deleteFaq: (id: number) => request<OkResponse>('/admin/support/faq/delete', { id })
};
