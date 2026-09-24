import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toggleTheme } from '../../design/theme';
import { useSession, useSessionData } from '../auth/useSession';
import { PeriodPicker } from './PeriodPicker';
import { useOnline } from './useOnline';
import s from './Shell.module.css';

export function TopBar({ title, onToggleNav }: { title: string; onToggleNav: () => void }) {
  const { user } = useSessionData();
  const { logout } = useSession();
  const navigate = useNavigate();
  const online = useOnline();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);

  return (
    <header className={s.top}>
      <div className={s.left}>
        <button type="button" className={[s.navToggle, s.brandBtn].join(' ')} aria-label="Разделы" title="Разделы" onClick={onToggleNav}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 19V10M12 19V5M20 19V13" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
        <h1 className={s.title}>{title}</h1>
      </div>
      <div className={s.right}>
        {!online && <span className={s.offline} role="status">Нет связи</span>}
        <PeriodPicker />
        <button type="button" className={s.iconBtn} aria-label="Обновить" onClick={() => void qc.invalidateQueries()}>⟳</button>
        <button type="button" className={s.iconBtn} aria-label="Тема" onClick={() => toggleTheme()}>◐</button>
        <div className={s.more}>
          <button type="button" className={s.iconBtn} aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu(m => !m)}>⋯</button>
          {menu && (
            <div className={s.menu} role="menu" onMouseLeave={() => setMenu(false)}>
              <div className={s.menuUser}>{user.fio}</div>
              <PeriodPicker variant="menu" />
              <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenu(false); navigate('/change-password'); }}>Сменить пароль</button>
              <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenu(false); void logout(); }}>Выйти</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
