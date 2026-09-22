import { useEffect, useRef, type ReactNode } from 'react';
import s from './Sheet.module.css';

type Props = { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode };

export function Sheet({ open, onClose, title, children, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={s.backdrop} onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={s.panel} onClick={e => e.stopPropagation()}>
        <div className={s.head}>
          <strong>{title}</strong>
          <button type="button" className={s.close} aria-label="Закрыть" onClick={onClose}>×</button>
        </div>
        <div className={s.content}>{children}</div>
        {footer && <div className={s.foot}>{footer}</div>}
      </div>
    </div>
  );
}
