import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { toggleTheme } from '../../design/theme';
import { useSession, useSessionData } from '../auth/useSession';
import { useCompWaitingCount } from '../compReview/useCompReview';
import { groupNavItems, type NavItem } from './NavItems';
import { PeriodPicker } from './PeriodPicker';
import s from './Sidebar.module.css';

/** Простые Unicode-глифы — без иконочного шрифта/библиотеки, тем же приёмом,
 * что и «◐» (тема) и «⋯» (ещё) в TopBar. Ключ — путь пункта, не icon-тип из
 * NavItem: «Оценка должностей» и «Риски» делят один тип 'scale', а глиф
 * нужен разный, чтобы отличать их в свёрнутой полосе. */
const GLYPH: Record<string, string> = {
  '/': '▤', '/support': '✉', '/registry': '▦', '/dashboard': '◧', '/dashboard/benchmark': '◨',
  '/coordination': '◍', '/grading': '◔', '/key-risks': '◭', '/comp': '₸',
  '/access': '⚿', '/admin': '⚙',
  '/admin/users': '◫', '/admin/divisions': '▥', '/admin/staff': '▧', '/admin/dictionary': '▨',
  '/admin/grading': '◑', '/admin/benchmark': '◐', '/admin/periods': '◷', '/admin/support': '✎',
  '/admin/broadcast': '➤', '/admin/audit-log': '☰', '/admin/service': '⚒', '/admin/comp-committee': '◈'
};

/** ФИО в строке заголовка на телефоне узкое место — «Фамилия Имя» целиком не
 * помещалось рядом с периодом и обрезалось многоточием. Фамилия остаётся
 * полностью, от имени (и отчества, если есть) — только первая буква. */
function shortFio(fio: string): string {
  const [last, first] = fio.trim().split(/\s+/);
  if (!last) return fio;
  return first ? `${last} ${first[0]}.` : last;
}

type Props = {
  items: NavItem[]; collapsed: boolean; open: boolean;
  onNavigate: () => void; onCloseMobile: () => void; onToggleCollapse: () => void;
};

export function Sidebar({ items, collapsed, open, onNavigate, onCloseMobile, onToggleCollapse }: Props) {
  const groups = groupNavItems(items);
  const { user } = useSessionData();
  const { logout } = useSession();
  const navigate = useNavigate();
  const compWaitingCount = useCompWaitingCount();
  return (
    <>
      <button
        type="button" className={[s.backdrop, open ? s.open : ''].join(' ')}
        aria-label="Закрыть меню" onClick={onCloseMobile}
      />
      <nav className={[s.sidebar, collapsed ? s.collapsed : '', open ? s.open : ''].join(' ')} aria-label="Разделы">
        {/* Логотип (тот же контур, что в старом клиенте — client/index.html
            #railBrand). Иконка сама — кнопка сворачивания. На телефоне вторая
            строка («Фаровон · C&B») заменяется именем пользователя и периодом
            — то же место, не отдельная строка ниже: их и просили показать
            прямо здесь, на одной строке с лого, а не новым пунктом в шторке. */}
        <div className={s.brand}>
          <button
            type="button" className={s.brandMark} onClick={onToggleCollapse}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title="Свернуть / развернуть меню"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 19V10M12 19V5M20 19V13" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
          <span className={s.brandText}>
            <span className={s.brandName}>Обзор рынка</span>
            <span className={s.brandSubDesktop}>Фаровон · C&amp;B</span>
            <span className={s.brandSubMobile}>
              <span className={s.accountUser}>{shortFio(user.fio)}</span>
              <span aria-hidden="true"> · </span>
              <PeriodPicker variant="inline" />
            </span>
          </span>
        </div>
        <div className={s.nav}>
          {groups.map(g => (
            <NavGroupBlock key={g.key} group={g} sidebarCollapsed={collapsed} onNavigate={onNavigate} compWaitingCount={compWaitingCount} />
          ))}
          {/* Только на телефоне (Sidebar.module.css, .mobileAccount) — здесь же,
              в той же шторке, живут кнопки, которые раньше были в шапке
              (Тема/Период/Пароль/Выйти): гамбургер в TabBar.tsx — единственный
              вход в меню на телефоне, дублировать его незачем. */}
          <div className={s.mobileAccount}>
            <button type="button" className={s.accountItem} onClick={() => toggleTheme()}>Сменить тему</button>
            <button type="button" className={s.accountItem} onClick={() => { onCloseMobile(); navigate('/profile'); }}>Профиль</button>
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
function NavGroupBlock({ group, sidebarCollapsed, onNavigate, compWaitingCount }: {
  group: { key: string; label: string | null; items: NavItem[] };
  sidebarCollapsed: boolean;
  onNavigate: () => void;
  compWaitingCount: number;
}) {
  const [expanded, setExpanded] = useState(() => loadGroupExpanded(group.key));
  const showItems = sidebarCollapsed || expanded;
  const location = useLocation();
  // «Дашборды» (/dashboard) и «Бенчмаркинг» (/dashboard/benchmark) делят один
  // маршрут-дерево — обычное префиксное совпадение NavLink подсветило бы оба
  // пункта разом на вкладке бенчмаркинга. «Дашборды» гаснет именно там, чтобы
  // подсвечивался только один пункт, как и остальные несмежные разделы.
  const hasBenchmarkItem = group.items.some(it => it.to === '/dashboard/benchmark');

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
      {showItems && group.items.map(i => {
        const suppressActive = hasBenchmarkItem && i.to === '/dashboard' && location.pathname.startsWith('/dashboard/benchmark');
        return (
          <NavLink
            key={i.to} to={i.to} end={i.to === '/'} onClick={onNavigate}
            className={({ isActive }) => [s.link, isActive && !suppressActive ? s.active : ''].join(' ')}
          >
            <span className={s.icon} aria-hidden="true">{GLYPH[i.to] ?? '•'}</span>
            <span className={s.label}>{i.label}</span>
            {i.to === '/comp' && compWaitingCount > 0 && (
              <span className={s.navBadge}>{compWaitingCount > 99 ? '99+' : compWaitingCount}</span>
            )}
          </NavLink>
        );
      })}
    </div>
  );
}
