export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

// Двойная отправка токена (CSRF) — см. src/middleware/csrf.js. Кука
// farovon_csrf не httpOnly специально: её должен прочитать этот код и
// вернуть тем же значением в заголовке.
function readCsrfCookie(): string | null {
  const m = /(?:^|;\s*)farovon_csrf=([^;]+)/.exec(document.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Единственная точка запросов к серверу. Ответы имеют форму { ok, ... } либо
 * { ok:false, error, fields? }. Текст ошибки сервера отдаётся как есть.
 */
export async function request<T>(path: string, body?: unknown, init: { method?: 'GET' | 'POST' } = {}): Promise<T> {
  const method = init.method ?? (body === undefined ? 'GET' : 'POST');
  let res: Response;
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      const csrfToken = readCsrfCookie();
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }
    res = await fetch('/api' + path, {
      method,
      credentials: 'include',
      headers: Object.keys(headers).length ? headers : undefined,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, data?.message || data?.error || 'Требуется вход');
  }
  if (!res.ok || !data || data.ok === false) {
    throw new ApiError(res.status, data?.message || data?.error || 'Ошибка сервера', data?.fields);
  }
  return data as T;
}
