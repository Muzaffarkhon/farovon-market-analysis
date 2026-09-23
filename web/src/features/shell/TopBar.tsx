import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toggleTheme } from '../../design/theme';
import { useSession, useSessionData } from '../auth/useSession';
import { PeriodPicker } from './PeriodPicker';
import { useOnline } from './useOnline';
import s from './Shell.module.css';

export function TopBar({ title, onToggleNav }: { title: string; onToggleNav: () => void }) {
  const { user, period } = useSessionData();
  const { logout } = useSession();
  const navigate = useNavigate();
  const online = useOnline();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);

  return (
    <header className={s.top}>
      <div className={s.left}>
        <button type="button" className={[s.iconBtn, s.navToggle].join(' ')} aria-label="Разделы" onClick={onToggleNav}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
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
              <div className={s.periodInMenu}>Период: {period.name}</div>
              <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenu(false); navigate('/change-password'); }}>Сменить пароль</button>
              <button type="button" role="menuitem" className={s.menuItem} onClick={() => { setMenu(false); void logout(); }}>Выйти</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
