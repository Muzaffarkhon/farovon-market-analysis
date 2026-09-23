import { request, ApiError, setUnauthorizedHandler } from './client';

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body }) as never;
}

test('ok:true возвращает тело', async () => {
  mockFetch(200, { ok: true, x: 1 });
  await expect(request<{ x: number }>('/auth/resume')).resolves.toEqual({ ok: true, x: 1 });
});

test('ok:false бросает ApiError с текстом сервера', async () => {
  mockFetch(400, { ok: false, error: 'Не указано подразделение' });
  await expect(request('/survey/for-period', {})).rejects.toMatchObject({ status: 400, message: 'Не указано подразделение' });
});

test('401 зовёт обработчик', async () => {
  const h = vi.fn();
  setUnauthorizedHandler(h);
  mockFetch(401, { ok: false, error: 'SESSION_EXPIRED', message: 'Сессия истекла' });
  await expect(request('/auth/resume')).rejects.toBeInstanceOf(ApiError);
  expect(h).toHaveBeenCalled();
});

test('fields прокидываются', async () => {
  mockFetch(400, { ok: false, error: 'Ошибка', fields: { payFrom: 'Только число' } });
  await expect(request('/x', {})).rejects.toMatchObject({ fields: { payFrom: 'Только число' } });
});

test('обрыв сети — статус 0 и понятный текст', async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never;
  await expect(request('/x')).rejects.toMatchObject({ status: 0, message: 'Нет связи с сервером' });
});

test('CSRF: заголовок X-CSRF-Token добавляется на не-GET из куки', async () => {
  document.cookie = 'farovon_csrf=test-token-123';
  mockFetch(200, { ok: true });
  await request('/x', {});
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers['X-CSRF-Token']).toBe('test-token-123');
  document.cookie = 'farovon_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

test('CSRF: заголовок не добавляется на GET', async () => {
  document.cookie = 'farovon_csrf=test-token-123';
  mockFetch(200, { ok: true });
  await request('/auth/resume');
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const [, init] = fetchMock.mock.calls[0];
  expect(init.headers).toBeUndefined();
  document.cookie = 'farovon_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});
