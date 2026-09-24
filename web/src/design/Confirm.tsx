import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import s from './Confirm.module.css';

type Options = { title?: string; message: string; okLabel?: string; cancelLabel?: string; danger?: boolean };
type Request = Options & { resolve: (v: boolean) => void };

const Ctx = createContext<{ confirm: (o: Options | string) => Promise<boolean> }>({ confirm: async () => false });

/**
 * Замена window.confirm(): тот же смысл (да/нет, блокирует поток кода до
 * ответа), но своя вёрстка вместо системного диалога браузера — тот выглядит
 * чужеродно (показывает адрес localhost:3000, не следует теме/дизайну) и на
 * телефоне через Telegram Mini App может вовсе не появиться.
 */
export function ConfirmHost({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const confirm = useCallback((o: Options | string) => {
    const opts = typeof o === 'string' ? { message: o } : o;
    return new Promise<boolean>(resolve => setRequest({ ...opts, resolve }));
  }, []);

  const close = (v: boolean) => {
    request?.resolve(v);
    setRequest(null);
  };

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  return (
    <Ctx.Provider value={{ confirm }}>
      {children}
      {request && (
        <div className={s.backdrop} onClick={() => close(false)}>
          <div ref={ref} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label={request.title || 'Подтвердите действие'} className={s.panel} onClick={e => e.stopPropagation()}>
            {request.title && <strong className={s.title}>{request.title}</strong>}
            <p className={s.message}>{request.message}</p>
            <div className={s.foot}>
              <Button variant="secondary" onClick={() => close(false)}>{request.cancelLabel || 'Отмена'}</Button>
              <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{request.okLabel || 'ОК'}</Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx).confirm;
