import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import s from './Toast.module.css';

export type ToastTone = 'info' | 'ok' | 'error';
type Item = { id: number; text: string; tone: ToastTone };
const Ctx = createContext<{ show: (text: string, tone?: ToastTone) => void }>({ show: () => {} });

// Не больше стольки одновременно на экране — если что-то шлёт разные
// сообщения подряд (а не один и тот же текст, который дедуп ниже уже
// схлопывает), старые просто уходят, а не растут стеной вверх по экрану.
const MAX_VISIBLE = 3;

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems(list => list.filter(i => i.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  // Повторный клик по «Обновить» (или любой другой источник одного и того
  // же сообщения) раньше добавлял ещё одну копию тоста — при нескольких
  // нажатиях подряд экран покрывался стопкой одинаковых «Обновлено».
  // Если такой текст уже показан, просто продлеваем его — не плодим копию.
  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    setItems(list => {
      const existing = list.find(i => i.text === text && i.tone === tone);
      if (existing) {
        const old = timers.current.get(existing.id);
        if (old) clearTimeout(old);
        timers.current.set(existing.id, setTimeout(() => dismiss(existing.id), 4000));
        return list;
      }
      const id = Date.now() + Math.random();
      timers.current.set(id, setTimeout(() => dismiss(id), 4000));
      const next = [...list, { id, text, tone }];
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className={s.host} role="status" aria-live="polite">
        {items.map(i => <div key={i.id} className={[s.toast, s[i.tone]].join(' ')}>{i.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
