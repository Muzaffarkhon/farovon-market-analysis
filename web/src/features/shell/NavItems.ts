import type { SessionUser } from '../../api/contract';

export type NavItem = { to: string; label: string; icon: 'list' | 'table' | 'chart' | 'users' | 'shield' };

/** Пункты навигации строятся из роли и прав; admin видит всё. */
export function navItemsFor(u: SessionUser): NavItem[] {
  const has = (c: string) => u.role === 'admin' || u.capabilities.includes(c);
  const items: NavItem[] = [];
  if (has('survey:fill')) items.push({ to: '/', label: 'Сбор данных', icon: 'list' });
  if (has('dashboard:view')) items.push({ to: '/registry', label: 'Реестр', icon: 'table' });
  if (has('dashboard:view')) items.push({ to: '/dashboard', label: 'Дашборды', icon: 'chart' });
  if (has('coordination:view')) items.push({ to: '/coordination', label: 'Координация', icon: 'users' });
  if (u.role === 'admin') items.push({ to: '/access', label: 'Роли и доступы', icon: 'shield' });
  return items;
}
