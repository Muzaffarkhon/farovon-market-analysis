import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { toggleTheme } from '../../design/theme';
import { useSession, useSessionData } from '../auth/useSession';
import { groupNavItems, type NavItem } from './NavItems';
import { PeriodPicker } from './PeriodPicker';
import s from './Sidebar.module.css';

/** Простые Unicode-глифы — без иконочного шрифта/библиотеки, тем же приёмом,
 * что и «◐» (тема) и «⋯» (ещё) в TopBar. Ключ — путь пункта, не icon-тип из
 * NavItem: «Оценка должностей» и «Риски» делят один тип 'scale', а глиф
 * нужен разный, чтобы отличать их в свёрнутой полосе. */
const GLYPH: Record<string, string> = {
  '/': '▤', '/support': '✉', '/registry': '▦', '/dashboard': '◧',
  '/coordination': '◍', '/grading': '◔', '/key-risks': '◭',
  '/access': '⚿', '/admin': '⚙'
};

type Props = {
  items: NavItem[]; collapsed: boolean; open: boolean;
  onNavigate: () => void; onCloseMobile: () => void; onToggleCollapse: () => void;
};

export function Sidebar({ items, collapsed, open, onNavigate, onCloseMobile, onToggleCollapse }: Props) {
  const groups = groupNavItems(items);
  const { user } = useSessionData();
  const { logout } = useSession();
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button" className={[s.backdrop, open ? s.open : ''].join(' ')}
        aria-label="Закрыть меню" onClick={onCloseMobile}
      />
      <nav className={[s.sidebar, collapsed ? s.collapsed : '', open ? s.open : ''].join(' ')} aria-label="Разделы">
        {/* Логотип (тот же контур, что в старом клиенте — client/index.html
            #railBrand) сам и есть кнопка сворачивания: клик по всей строке
            переключает, отдельная стрелка не нужна — иконка остаётся видна
            и в свёрнутом виде. */}
        <button
          type="button" className={s.brand} onClick={onToggleCollapse}
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title="Свернуть / развернуть меню"
        >
          <span className={s.brandMark} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 19V10M12 19V5M20 19V13" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
          <span className={s.brandText}>
            <span className={s.brandName}>Обзор рынка</span>
            <span className={s.brandSub}>Фаровон · C&amp;B</span>
          </span>
        </button>
        <div className={s.nav}>
          {groups.map(g => (
            <NavGroupBlock key={g.key} group={g} sidebarCollapsed={collapsed} onNavigate={onNavigate} />
          ))}
          {/* Только на телефоне (Sidebar.module.css, .mobileAccount) — здесь же,
              в той же шторке, живут кнопки, которые раньше были в шапке
              (Тема/Период/Пароль/Выйти): гамбургер в TabBar.tsx — единственный
              вход в меню на телефоне, дублировать его незачем. */}
          <div className={s.mobileAccount}>
            <div className={s.accountRow}>
              <span className={s.accountUser}>{user.fio}</span>
              <span aria-hidden="true">·</span>
              <PeriodPicker variant="inline" />
            </div>
            <button type="button" className={s.accountItem} onClick={() => toggleTheme()}>Сменить тему</button>
            <button type="button" className={s.accountItem} onClick={() => { onCloseMobile(); navigate('/change-password'); }}>Сменить пароль</button>
            <button type="button" className={s.accountItem} onClick={() => { onCloseMobile(); void logout(); }}>Выйти</button>
          </div>
        </div>
      </nav>
    </>
  );
}

function loadGroupExpanded(key: string): boolean {
  try { return window.localStorage.getItem(`nav-group-${key}`) !== '0'; } catch { return true; }
}

/** Подраздел панели — заголовок сворачивает свои пункты (состояние на
 * телефоне/десктопе своё, в localStorage). В свёрнутой узкой панели
 * заголовков нет — там видны только иконки всех пунктов подряд. */
function NavGroupBlock({ group, sidebarCollapsed, onNavigate }: {
  group: { key: string; label: string | null; items: NavItem[] };
  sidebarCollapsed: boolean;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(() => loadGroupExpanded(group.key));
  const showItems = sidebarCollapsed || expanded;

  return (
    <div className={s.group}>
      {group.label && (
        <button
          type="button" className={s.groupHead}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(e => {
              const next = !e;
              try { window.localStorage.setItem(`nav-group-${group.key}`, next ? '1' : '0'); } catch { /* приватный режим */ }
              return next;
            });
          }}
        >
          <span className={s.groupLabel}>{group.label}</span>
          <span className={[s.groupChevron, expanded ? s.groupChevronOpen : ''].join(' ')} aria-hidden="true">›</span>
        </button>
      )}
      {showItems && group.items.map(i => (
        <NavLink
          key={i.to} to={i.to} end={i.to === '/'} onClick={onNavigate}
          className={({ isActive }) => [s.link, isActive ? s.active : ''].join(' ')}
        >
          <span className={s.icon} aria-hidden="true">{GLYPH[i.to] ?? '•'}</span>
          <span className={s.label}>{i.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
