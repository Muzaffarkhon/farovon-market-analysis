import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { toggleTheme } from '../../design/theme';
import { useSession, useSessionData } from '../auth/useSession';
import { navItemsFor } from './NavItems';
import { PeriodPicker } from './PeriodPicker';
import { useOnline } from './useOnline';
import s from './Shell.module.css';

export function TopBar({ title }: { title: string }) {
  const { user, period } = useSessionData();
  const { logout } = useSession();
  const navigate = useNavigate();
  const online = useOnline();
  const [menu, setMenu] = useState(false);
  const items = navItemsFor(user);

  return (
    <header className={s.top}>
      <div className={s.left}>
        <nav className={s.topNav} aria-label="Разделы">
          {items.map(i => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => [s.topLink, isActive ? s.active : ''].join(' ')}>{i.label}</NavLink>
          ))}
        </nav>
        <h1 className={s.title}>{title}</h1>
      </div>
      <div className={s.right}>
        {!online && <span className={s.offline} role="status">Нет связи</span>}
        <PeriodPicker />
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
