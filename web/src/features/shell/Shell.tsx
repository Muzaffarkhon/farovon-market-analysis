import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useSessionData } from '../auth/useSession';
import { navItemsFor } from './NavItems';
import { TopBar } from './TopBar';
import s from './Shell.module.css';

const TitleCtx = createContext<(t: string) => void>(() => {});

/** Экран объявляет свой заголовок — он уходит в верхнюю панель и во вкладку. */
export function useScreenTitle(title: string) {
  const set = useContext(TitleCtx);
  useEffect(() => { set(title); document.title = title + ' — Обзор рынка'; }, [title, set]);
}

export function Shell({ children }: { children?: ReactNode }) {
  const { user } = useSessionData();
  const [title, setTitle] = useState('');
  const items = navItemsFor(user);
  return (
    <TitleCtx.Provider value={setTitle}>
      <div className={s.shell}>
        <TopBar title={title} />
        <main className={s.main}>{children ?? <Outlet />}</main>
        {items.length > 1 && (
          <nav className={s.bottom} aria-label="Разделы">
            {items.map(i => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => [s.bottomLink, isActive ? s.active : ''].join(' ')}>{i.label}</NavLink>
            ))}
          </nav>
        )}
      </div>
    </TitleCtx.Provider>
  );
}
