import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import s from './Toast.module.css';

export type ToastTone = 'info' | 'ok' | 'error';
type Item = { id: number; text: string; tone: ToastTone };
const Ctx = createContext<{ show: (text: string, tone?: ToastTone) => void }>({ show: () => {} });

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const show = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setItems(list => [...list, { id, text, tone }]);
    setTimeout(() => setItems(list => list.filter(i => i.id !== id)), 4000);
  }, []);
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
