import { request } from './client';
import type { OkResponse, TelegramBotInfoResponse, TelegramLinkResponse } from './contract';

export const telegramApi = {
  botInfo: () => request<TelegramBotInfoResponse>('/telegram/bot-info'),
  link: () => request<TelegramLinkResponse>('/telegram/link', {}),
  unlink: () => request<OkResponse>('/telegram/unlink', {})
};
