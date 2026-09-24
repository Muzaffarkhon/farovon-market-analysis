import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { authApi } from '../../api/auth';

const POLL_MS = 45_000;

/**
 * Аналог client/liveRefresh.js: раз в ~45с сверяет «подпись» данных
 * (GET /api/live-signature) и, если она изменилась, обновляет экран —
 * без WebSocket/SSE (см. комментарий в src/controllers/liveController.js
 * про serverless-ограничения Vercel).
 *
 * Вместо точечного различения «дашборд или админка», как в старом клиенте,
 * здесь просто инвалидируются все активные запросы (тот же приём, что и
 * ручная кнопка «Обновить» в TopBar.tsx / pull-to-refresh в Shell.tsx) —
 * формы в открытых Sheet-модалках хранят значения в собственном useState,
 * инициализированном один раз из пропа, поэтому фоновый рефетч списка под
 * ними не портит то, что человек сейчас редактирует.
 */
export function useLiveRefresh() {
  const qc = useQueryClient();
  const lastSig = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (document.visibilityState === 'visible') {
        try {
          const r = await authApi.liveSignature();
          if (cancelled) return;
          if (lastSig.current === null) {
            // Первый опрос — только запоминаем базу, не считаем «изменением»,
            // иначе каждый вход в приложение выглядел бы как обновление.
            lastSig.current = r.sig;
          } else if (r.sig !== lastSig.current) {
            lastSig.current = r.sig;
            void qc.invalidateQueries();
          }
        } catch {
          // Сеть моргнула — тихо попробуем на следующем тике.
        }
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void tick();
    }

    void tick();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [qc]);
}
