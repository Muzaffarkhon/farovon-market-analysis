import { NavLink } from 'react-router';
import { Icon, type IconName } from '../../design/Icon';
import type { NavItem } from './NavItems';
import s from './Shell.module.css';

const ICON: Record<string, IconName> = { '/': 'collect', '/registry': 'grid', '/dashboard': 'dashboard', '/admin': 'settings' };
// Короче, чем полные подписи в боковой панели (Sidebar.tsx) — под узкий тап.
const SHORT_LABEL: Record<string, string> = { '/': 'Сбор', '/registry': 'Реестр', '/dashboard': 'Дашборды', '/admin': 'Админка' };
// Порядок в панели: самый частый раздел («Сбор данных») — приподнятым
// кружком вторым слева, ближе к центру, а не рядовым пунктом с остальными.
const TAB_ORDER = ['/registry', '/', '/dashboard', '/admin'];

/** Постоянная панель разделов внизу экрана на телефоне (Shell.tsx). Пятая
 * кнопка — гамбургер (☰), открывает полный список (Sidebar.tsx, шторка
 * снизу) и через него же — тему/пароль/выход (Sidebar.module.css
 * .mobileAccount). Логотип платформы — в шапке (TopBar.tsx, .logoMark),
 * здесь дублировать его не нужно. */
export function TabBar({ items, onOpenMenu }: { items: NavItem[]; onOpenMenu: () => void }) {
  const byPath = new Map(items.map(i => [i.to, i]));
  const tabs = TAB_ORDER.map(to => byPath.get(to)).filter((i): i is NavItem => !!i);

  return (
    <nav className={s.tabBar} aria-label="Основные разделы">
      {tabs.map(i => (
        <NavLink
          key={i.to} to={i.to} end={i.to === '/'}
          // Приподнятый кружок — не постоянно на «Сборе», а на том пункте,
          // что сейчас активен: переключается вместе с разделом.
          className={({ isActive }) => [s.tabItem, isActive ? s.tabPrimary : '', isActive ? s.tabActive : ''].join(' ')}
        >
          {({ isActive }) => (
            <>
              {/* Активный «Сбор» — сплошной приподнятый кружок (белая иконка
                  на градиенте, .tabPrimary .tabIcon) — там градиентная заливка
                  контура перебивала бы белый цвет, поэтому gradient только у
                  обычных (неактивных) иконок панели. */}
              <span className={s.tabIcon} aria-hidden="true">
                <Icon name={ICON[i.to] ?? 'collect'} gradient={!isActive} size={14} />
              </span>
              <span>{SHORT_LABEL[i.to] ?? i.label}</span>
            </>
          )}
        </NavLink>
      ))}
      <button type="button" className={s.tabItem} aria-label="Ещё разделы" onClick={onOpenMenu}>
        <span className={s.tabIcon} aria-hidden="true"><Icon name="menu" size={14} /></span>
        <span>Ещё</span>
      </button>
    </nav>
  );
}
