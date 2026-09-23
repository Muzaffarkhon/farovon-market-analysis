import { NavLink } from 'react-router';
import type { NavItem } from './NavItems';
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
  return (
    <>
      <button
        type="button" className={[s.backdrop, open ? s.open : ''].join(' ')}
        aria-label="Закрыть меню" onClick={onCloseMobile}
      />
      <nav className={[s.sidebar, collapsed ? s.collapsed : '', open ? s.open : ''].join(' ')} aria-label="Разделы">
        <div className={s.brand}>
          <span className={s.brandMark} aria-hidden="true">ОР</span>
          <span className={s.brandName}>Обзор рынка</span>
          <button
            type="button" className={s.collapseBtn} onClick={onToggleCollapse}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
        <div className={s.nav}>
          {items.map(i => (
            <NavLink
              key={i.to} to={i.to} end={i.to === '/'} onClick={onNavigate}
              className={({ isActive }) => [s.link, isActive ? s.active : ''].join(' ')}
            >
              <span className={s.icon} aria-hidden="true">{GLYPH[i.to] ?? '•'}</span>
              <span className={s.label}>{i.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
