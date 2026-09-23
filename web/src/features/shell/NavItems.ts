import type { SessionUser } from '../../api/contract';

export type NavItem = { to: string; label: string; icon: 'list' | 'table' | 'chart' | 'users' | 'scale' | 'shield' | 'gear' | 'chat' };

/** Пункты навигации строятся из роли и прав; admin видит всё. */
export function navItemsFor(u: SessionUser): NavItem[] {
  const has = (c: string) => u.role === 'admin' || u.capabilities.includes(c);
  const items: NavItem[] = [];
  if (has('survey:fill')) items.push({ to: '/', label: 'Сбор данных', icon: 'list' });
  items.push({ to: '/support', label: 'Поддержка', icon: 'chat' });
  if (has('dashboard:view')) items.push({ to: '/registry', label: 'Реестр', icon: 'table' });
  if (has('dashboard:view')) items.push({ to: '/dashboard', label: 'Дашборды', icon: 'chart' });
  if (has('coordination:view')) items.push({ to: '/coordination', label: 'Координация', icon: 'users' });
  if (has('grading:view') || has('grading:edit')) items.push({ to: '/grading', label: 'Оценка должностей', icon: 'scale' });
  if (has('keyrisk:view') || has('keyrisk:edit')) items.push({ to: '/key-risks', label: 'Риски', icon: 'scale' });
  if (u.role === 'admin') items.push({ to: '/access', label: 'Роли и доступы', icon: 'shield' });
  if (isAdminAreaVisible(u)) items.push({ to: '/admin', label: 'Администрирование', icon: 'gear' });
  return items;
}

const ADMIN_CAPS = [
  'users:view', 'divisions:view', 'dictionary:view',
  'grading:factors', 'grading:blocks', 'grading:committee',
  'benchmarks:import', 'benchmarks:map', 'period:view'
];

function isAdminAreaVisible(u: SessionUser): boolean {
  return u.role === 'admin' || ADMIN_CAPS.some(c => u.capabilities.includes(c));
}
