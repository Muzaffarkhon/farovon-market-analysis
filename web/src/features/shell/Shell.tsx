import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useSessionData } from '../auth/useSession';
import { navItemsFor } from './NavItems';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import s from './Shell.module.css';

const TitleCtx = createContext<(t: string) => void>(() => {});

/** Экран объявляет свой заголовок — он уходит в верхнюю панель и во вкладку. */
export function useScreenTitle(title: string) {
  const set = useContext(TitleCtx);
  useEffect(() => { set(title); document.title = title + ' — Обзор рынка'; }, [title, set]);
}

const COLLAPSE_KEY = 'nav-collapsed';

function loadCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

export function Shell({ children }: { children?: ReactNode }) {
  const { user } = useSessionData();
  const [title, setTitle] = useState('');
  const items = navItemsFor(user);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Переход на новый экран закрывает выдвижное меню телефона — иначе оно
  // перекрывает контент после клика по пункту.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  function toggleNav() {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setCollapsed(c => {
        const next = !c;
        try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* приватный режим */ }
        return next;
      });
    } else {
      setMobileOpen(o => !o);
    }
  }

  return (
    <TitleCtx.Provider value={setTitle}>
      <div className={s.shell}>
        <Sidebar
          items={items} collapsed={collapsed} open={mobileOpen}
          onNavigate={() => setMobileOpen(false)} onCloseMobile={() => setMobileOpen(false)}
        />
        <div className={s.column}>
          <TopBar title={title} onToggleNav={toggleNav} />
          <main className={s.main}>{children ?? <Outlet />}</main>
        </div>
      </div>
    </TitleCtx.Provider>
  );
}
