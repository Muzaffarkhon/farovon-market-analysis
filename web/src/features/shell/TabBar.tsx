import { NavLink } from 'react-router';
import type { NavItem } from './NavItems';
import s from './Shell.module.css';

const GLYPH: Record<string, string> = { '/': '▤', '/registry': '▦', '/dashboard': '◧', '/admin': '⚙' };
// Короче, чем полные подписи в боковой панели (Sidebar.tsx) — под узкий тап.
const SHORT_LABEL: Record<string, string> = { '/': 'Сбор', '/registry': 'Реестр', '/dashboard': 'Дашборды', '/admin': 'Админка' };
// Порядок в панели: самый частый раздел («Сбор данных») — приподнятым
// кружком вторым слева, ближе к центру, а не рядовым пунктом с остальными.
const TAB_ORDER = ['/registry', '/', '/dashboard', '/admin'];

/** Постоянная панель из 4 разделов внизу экрана на телефоне (Shell.tsx). */
export function TabBar({ items }: { items: NavItem[] }) {
  const byPath = new Map(items.map(i => [i.to, i]));
  const tabs = TAB_ORDER.map(to => byPath.get(to)).filter((i): i is NavItem => !!i);
  if (!tabs.length) return null;

  return (
    <nav className={s.tabBar} aria-label="Основные разделы">
      {tabs.map(i => (
        <NavLink
          key={i.to} to={i.to} end={i.to === '/'}
          className={({ isActive }) => [s.tabItem, i.to === '/' ? s.tabPrimary : '', isActive ? s.tabActive : ''].join(' ')}
        >
          <span className={s.tabIcon} aria-hidden="true">{GLYPH[i.to] ?? '•'}</span>
          <span>{SHORT_LABEL[i.to] ?? i.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
