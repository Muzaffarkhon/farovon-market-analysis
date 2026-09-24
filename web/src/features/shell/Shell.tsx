import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useSessionData } from '../auth/useSession';
import { navItemsFor } from './NavItems';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import { usePullToRefresh } from './usePullToRefresh';
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
  const qc = useQueryClient();
  const mainRef = useRef<HTMLElement | null>(null);
  // На телефоне кнопки «Обновить» в шапке больше нет (Sidebar/TabBar теперь
  // внизу) — обновление жестом «потянуть вниз», как в браузере/приложениях.
  const { pull, refreshing } = usePullToRefresh(mainRef, () => qc.invalidateQueries());

  // Переход на новый экран закрывает выдвижное меню телефона — иначе оно
  // перекрывает контент после клика по пункту.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* приватный режим */ }
      return next;
    });
  }

  function toggleNav() {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      toggleCollapsed();
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
          onToggleCollapse={toggleNav}
        />
        <div className={s.column}>
          <TopBar title={title} />
          <main ref={mainRef} className={s.main}>
            <div className={s.pullIndicator} style={{ height: refreshing ? 40 : pull }} aria-hidden="true">
              {(pull > 4 || refreshing) && <span className={[s.pullIcon, refreshing ? s.pullSpin : ''].join(' ')}>⟳</span>}
            </div>
            {children ?? <Outlet />}
          </main>
          <TabBar items={items} onOpenMenu={toggleNav} />
        </div>
      </div>
    </TitleCtx.Provider>
  );
}
