// Farovon Market Analysis PWA Service Worker
const CACHE_NAME = 'farovon-market-v2-5-190';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);
  // Новый интерфейс (/new) и API не трогаем: у нового клиента собственные
  // ассеты с хешами в именах, а ответы API кэшировать нельзя в принципе.
  // Область действия воркера — весь сайт, поэтому исключения нужны явные.
  if (url.pathname === '/new' || url.pathname.startsWith('/new/') || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request).catch(async (err) => {
      // Кэш наполняется только тем, что туда положили явно; если ничего нет,
      // отдать undefined нельзя — браузер покажет «сломанный ответ» вместо
      // честной сетевой ошибки. Поэтому при промахе пробрасываем исходную.
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw err;
    })
  );
});
