import type { SessionUser } from '../../api/contract';

export type NavItem = { to: string; label: string; icon: 'list' | 'table' | 'chart' | 'users' | 'scale' | 'shield' | 'gear' | 'chat' | 'money' };

/** Пункты навигации строятся из роли и прав; admin видит всё. */
export function navItemsFor(u: SessionUser): NavItem[] {
  const has = (c: string) => u.role === 'admin' || u.capabilities.includes(c);
  const items: NavItem[] = [];
  if (has('survey:fill')) items.push({ to: '/', label: 'Сбор данных', icon: 'list' });
  // Личная «Поддержка» — написать свой вопрос. У кого уже есть админский
  // инбокс (support:manage), незачем писать самому себе отдельной формой —
  // он просто отвечает в своём инбоксе (см. client/app.js:267, тот же приём).
  if (!has('support:manage')) items.push({ to: '/support', label: 'Поддержка', icon: 'chat' });
  if (has('dashboard:view')) items.push({ to: '/registry', label: 'Реестр', icon: 'table' });
  if (has('dashboard:view')) items.push({ to: '/dashboard', label: 'Дашборды', icon: 'chart' });
  if (has('coordination:view')) items.push({ to: '/coordination', label: 'Координация', icon: 'users' });
  if (has('grading:view') || has('grading:edit')) items.push({ to: '/grading', label: 'Оценка должностей', icon: 'scale' });
  if (has('salary:request') || has('salary:approve_cb') || has('salary:approve_hrd') || has('salary:committee') || has('salary:view')) {
    items.push({ to: '/salary', label: 'Заявки на зарплату', icon: 'money' });
  }
  if (has('keyrisk:view') || has('keyrisk:edit')) items.push({ to: '/key-risks', label: 'Риски', icon: 'scale' });
  if (u.role === 'admin') items.push({ to: '/access', label: 'Роли и доступы', icon: 'shield' });
  if (isAdminAreaVisible(u)) items.push({ to: '/admin', label: 'Администрирование', icon: 'gear' });
  return items;
}

const ADMIN_CAPS = [
  'users:view', 'divisions:view', 'dictionary:view',
  'grading:factors', 'grading:blocks', 'grading:committee',
  'benchmarks:import', 'benchmarks:map', 'period:view', 'support:manage', 'broadcast:send', 'service:view', 'salary:committee'
];

function isAdminAreaVisible(u: SessionUser): boolean {
  return u.role === 'admin' || ADMIN_CAPS.some(c => u.capabilities.includes(c));
}

export type NavGroup = { key: string; label: string | null; items: NavItem[] };

// Раскладка по подразделам — только для отображения в панели (Sidebar.tsx),
// сам список и его порядок (navItemsFor) не меняются, чтобы не задеть уже
// проверенный тестами порядок пунктов.
const GROUP_OF: Record<string, string> = {
  '/registry': 'analytics', '/dashboard': 'analytics', '/coordination': 'analytics',
  '/grading': 'people', '/key-risks': 'people', '/salary': 'people',
  '/access': 'manage', '/admin': 'manage'
};
const GROUP_LABEL: Record<string, string> = { analytics: 'Аналитика', people: 'Персонал', manage: 'Управление' };
const GROUP_ORDER = ['quick', 'analytics', 'people', 'manage'];

export function groupNavItems(items: NavItem[]): NavGroup[] {
  const buckets: Record<string, NavItem[]> = {};
  for (const it of items) {
    const key = GROUP_OF[it.to] ?? 'quick';
    (buckets[key] ??= []).push(it);
  }
  return GROUP_ORDER.filter(k => buckets[k]?.length).map(k => ({ key: k, label: GROUP_LABEL[k] ?? null, items: buckets[k] }));
}
