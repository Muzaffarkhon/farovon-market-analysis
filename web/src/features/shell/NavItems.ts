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
  // В старом клиенте «Бенчмаркинг» — отдельный пункт меню (не спрятан внутри
  // Дашбордов), виден по своему праву benchmarks:view независимо от
  // dashboard:view. Переиспользуем ту же вкладку /dashboard/benchmark —
  // отдельного экрана заводить незачем, только путь в меню отдельный.
  if (has('benchmarks:view')) items.push({ to: '/dashboard/benchmark', label: 'Бенчмаркинг', icon: 'chart' });
  if (has('grading:view') || has('grading:edit')) items.push({ to: '/grading', label: 'Оценка должностей', icon: 'scale' });
  if (has('comp:submit') || has('comp:review_cb') || has('comp:approve_hrd') || has('comp:vote') || has('comp:payroll') || has('comp:admin')) {
    items.push({ to: '/comp', label: 'Пересмотр ЗП', icon: 'money' });
  }
  if (has('keyrisk:view') || has('keyrisk:edit')) items.push({ to: '/key-risks', label: 'Риски', icon: 'scale' });
  if (u.role === 'admin') items.push({ to: '/access', label: 'Роли и доступы', icon: 'shield' });
  if (isAdminAreaVisible(u)) items.push({ to: '/admin', label: 'Администрирование', icon: 'gear' });

  // Подразделы «Администрирования» — раньше видны только карточками внутри
  // самого раздела (AdminHub.tsx), сюда в левое меню не выводились. В старом
  // клиенте они были доступны прямо из меню (выпадашка у «Администрирования»),
  // без промежуточного перехода на страницу-хаб. Права — те же, что у
  // соответствующих карточек AdminHub.SECTIONS, чтобы не разойтись.
  if (has('users:view')) items.push({ to: '/admin/users', label: 'Пользователи', icon: 'users' });
  if (has('divisions:view')) items.push({ to: '/admin/divisions', label: 'Оргструктура', icon: 'gear' });
  if (has('dictionary:view')) items.push({ to: '/admin/staff', label: 'Справочник сотрудников', icon: 'gear' });
  if (has('dictionary:view')) items.push({ to: '/admin/dictionary', label: 'Справочники', icon: 'gear' });
  if (has('grading:factors') || has('grading:blocks') || has('grading:committee')) {
    items.push({ to: '/admin/grading', label: 'Грейдирование — настройка', icon: 'scale' });
  }
  if (has('benchmarks:import') || has('benchmarks:map')) items.push({ to: '/admin/benchmark', label: 'Бенчмаркинг — источники', icon: 'chart' });
  if (has('period:view')) items.push({ to: '/admin/periods', label: 'Периоды сбора', icon: 'gear' });
  if (has('support:manage')) items.push({ to: '/admin/support', label: 'Чат поддержки', icon: 'chat' });
  if (has('broadcast:send')) items.push({ to: '/admin/broadcast', label: 'Рассылка', icon: 'chat' });
  if (has('service:view')) items.push({ to: '/admin/audit-log', label: 'Журнал изменений', icon: 'gear' });
  if (has('service:view')) items.push({ to: '/admin/service', label: 'Обслуживание и статус данных', icon: 'gear' });
  if (has('comp:admin')) items.push({ to: '/admin/comp-committee', label: 'Пересмотр ЗП — комиссия', icon: 'money' });

  return items;
}

const ADMIN_CAPS = [
  'users:view', 'divisions:view', 'dictionary:view',
  'grading:factors', 'grading:blocks', 'grading:committee',
  'benchmarks:import', 'benchmarks:map', 'period:view', 'support:manage', 'broadcast:send', 'service:view', 'comp:admin'
];

function isAdminAreaVisible(u: SessionUser): boolean {
  return u.role === 'admin' || ADMIN_CAPS.some(c => u.capabilities.includes(c));
}

export type NavGroup = { key: string; label: string | null; items: NavItem[] };

// Раскладка по подразделам — только для отображения в панели (Sidebar.tsx),
// сам список и его порядок (navItemsFor) не меняются, чтобы не задеть уже
// проверенный тестами порядок пунктов.
const GROUP_OF: Record<string, string> = {
  '/registry': 'analytics', '/dashboard': 'analytics', '/dashboard/benchmark': 'analytics', '/coordination': 'analytics',
  '/grading': 'people', '/key-risks': 'people', '/comp': 'people',
  '/access': 'manage', '/admin': 'manage',
  // Та же раскладка по смыслу, что и у карточек внутри AdminHub.tsx (SECTIONS/group) —
  // те же четыре категории, чтобы человек, уже знакомый со страницей «Администрирование»,
  // сразу узнавал группировку в левом меню.
  '/admin/users': 'adminAccess',
  '/admin/divisions': 'adminStructure', '/admin/staff': 'adminStructure', '/admin/dictionary': 'adminStructure',
  '/admin/grading': 'adminMethod', '/admin/benchmark': 'adminMethod',
  '/admin/periods': 'adminProcess', '/admin/support': 'adminProcess', '/admin/broadcast': 'adminProcess',
  '/admin/audit-log': 'adminProcess', '/admin/service': 'adminProcess', '/admin/comp-committee': 'adminProcess'
};
const GROUP_LABEL: Record<string, string> = {
  analytics: 'Аналитика', people: 'Персонал', manage: 'Управление',
  adminAccess: 'Пользователи и доступ', adminStructure: 'Структура и штат',
  adminMethod: 'Методология', adminProcess: 'Процесс сбора'
};
const GROUP_ORDER = ['quick', 'analytics', 'people', 'manage', 'adminAccess', 'adminStructure', 'adminMethod', 'adminProcess'];

export function groupNavItems(items: NavItem[]): NavGroup[] {
  const buckets: Record<string, NavItem[]> = {};
  for (const it of items) {
    const key = GROUP_OF[it.to] ?? 'quick';
    (buckets[key] ??= []).push(it);
  }
  return GROUP_ORDER.filter(k => buckets[k]?.length).map(k => ({ key: k, label: GROUP_LABEL[k] ?? null, items: buckets[k] }));
}
