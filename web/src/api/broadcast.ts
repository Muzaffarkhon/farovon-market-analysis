import { request } from './client';
import type {
  BroadcastRecipientsResponse, BroadcastListResponse, BroadcastDetailsResponse,
  SendBroadcastPayload, SendBroadcastResponse
} from './contract';

export const broadcastApi = {
  recipients: () => request<BroadcastRecipientsResponse>('/admin/broadcasts/recipients'),
  list: () => request<BroadcastListResponse>('/admin/broadcasts'),
  details: (id: number) => request<BroadcastDetailsResponse>(`/admin/broadcasts/${id}`),
  send: (payload: SendBroadcastPayload) => request<SendBroadcastResponse>('/admin/broadcasts/send', payload)
};
