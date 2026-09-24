import { useEffect, useState } from 'react';
import { authApi } from '../../api/auth';
import { telegramApi } from '../../api/telegram';
import { ApiError } from '../../api/client';
import { Button } from '../../design/Button';
import { Sheet } from '../../design/Sheet';
import { Skeleton } from '../../design/Skeleton';
import { useToast } from '../../design/Toast';
import { useSession } from './useSession';
import s from '../admin/Admin.module.css';

/**
 * Привязка Telegram — как в старом клиенте (client/app.js, openTelegramLink):
 * основной путь — команда /link в самом боте (там же делятся номером
 * телефона, сервер сверяет с users.phone), диплинк с одноразовым кодом —
 * запасной вариант на случай, если Telegram-клиент не подставляет /start
 * автоматически. Сама привязка происходит на стороне бота — здесь только
 * инструкция и кнопка «Проверить», которая перечитывает сессию.
 */
export function TelegramLinkSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { setData } = useSession();
  const [botUsername, setBotUsername] = useState<string | null | undefined>(undefined);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([telegramApi.botInfo(), telegramApi.link()])
      .then(([info, link]) => {
        if (cancelled) return;
        setBotUsername(info.username);
        setDeepLink(link.deepLink);
        setExpiresIn(link.expiresInMinutes);
      })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : 'Не удалось подготовить ссылку'); });
    return () => { cancelled = true; };
  }, []);

  async function check() {
    setChecking(true);
    try {
      const r = await authApi.resume();
      setData(r.data);
      const linked = r.data.user.hasTelegram;
      toast.show(linked ? 'Telegram привязан' : 'Пока не привязан — попробуйте ещё раз', linked ? 'ok' : 'error');
      if (linked) onClose();
    } catch {
      toast.show('Не удалось проверить', 'error');
    } finally {
      setChecking(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Привязать Telegram">
      <div className={s.form}>
        {error && <p className={s.empty}>{error}</p>}
        {!error && botUsername === undefined && <Skeleton lines={4} />}
        {!error && botUsername !== undefined && (
          <>
            <p className={s.hint}>
              {botUsername
                ? <>Откройте бота <b>@{botUsername}</b> и отправьте команду <code>/link</code> — бот попросит поделиться номером телефона и сверит его с вашим профилем.</>
                : 'Telegram-бот сейчас недоступен.'}
            </p>
            {botUsername && (
              <Button onClick={() => window.open(`https://t.me/${botUsername}`, '_blank', 'noopener')}>
                Открыть @{botUsername}
              </Button>
            )}
            {deepLink && (
              <p className={s.hint}>
                Или перейдите по <a href={deepLink} target="_blank" rel="noopener noreferrer">ссылке с кодом</a> — сработает не во всех Telegram-клиентах, действует {expiresIn} мин.
              </p>
            )}
            <div className={s.formFoot}>
              <Button variant="secondary" loading={checking} onClick={check}>Проверить</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
