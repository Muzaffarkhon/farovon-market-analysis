import { useState } from 'react';
import { Link } from 'react-router';
import type { SessionUser } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import { useSupportUnreadCount } from './support/useSupportUnreadCount';
import s from './Admin.module.css';

type IconName = 'users' | 'units' | 'book' | 'dict' | 'grades' | 'chart' | 'clock' | 'chat' | 'shield' | 'send' | 'log' | 'money' | 'tools';
type GroupKey = 'access' | 'structure' | 'method' | 'process';
type Section = { to: string; title: string; note: string; icon: IconName; group: GroupKey; visible: (u: SessionUser) => boolean };

// Тот же приём, что и в левом меню (Sidebar.tsx) — восемь плиток вперемешку
// было тяжело сканировать глазами, разложил по смыслу на подразделы.
const GROUP_LABEL: Record<GroupKey, string> = {
  access: 'Пользователи и доступ',
  structure: 'Структура и штат',
  method: 'Методология',
  process: 'Процесс сбора'
};
const GROUP_ORDER: GroupKey[] = ['access', 'structure', 'method', 'process'];

// Те же SVG-пути, что в старом клиенте (client/app-core.js, ICONS) — для
// узнаваемости при переходе со старой версии на новую.
const ICON_PATHS: Record<IconName, string> = {
  users: '<circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.9"/><path d="M3.5 19c.7-3.3 3-5 5.5-5s4.8 1.7 5.5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="17" cy="8.5" r="2.6" stroke="currentColor" stroke-width="1.9"/><path d="M15.3 19c.5-2.6 1.9-4.3 4.7-4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  units: '<rect x="3" y="3" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="14" y="12" width="7" height="9" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="16" width="7" height="5" rx="1.5" stroke="currentColor" stroke-width="2"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H12v18H6.5A2.5 2.5 0 014 18.5v-13z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 5.5A2.5 2.5 0 0017.5 3H12v18h5.5a2.5 2.5 0 002.5-2.5v-13z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  grades: '<path d="M3.5 20.5h5.5V15H3.5v5.5zM9 20.5h6V9.5H9v11zM15 20.5h5.5V4H15v16.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  chat: '<path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8A2.5 2.5 0 0117.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 014 13.5v-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 12.2l2 2 3.6-3.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5L4 12z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  log: '<path d="M5 3.5h11l3 3V20.5H5V3.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  money: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M9.5 9.8c0-1.3 1.1-2 2.5-2s2.5.7 2.5 1.8c0 2.4-5 1.2-5 3.6 0 1.1 1.1 1.8 2.5 1.8s2.5-.7 2.5-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  dict: '<circle cx="9" cy="12" r="6" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="12" r="6" stroke="currentColor" stroke-width="1.8"/>',
  tools: '<path d="M14.7 6.3a4 4 0 015.6 5.6l-1 1-5.6-5.6 1-1z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.3 7.7L4.5 16.5a2 2 0 000 2.8l.2.2a2 2 0 002.8 0l8.8-8.8" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M5 19l-1.5 1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }} />
  );
}

const SECTIONS: Section[] = [
  { to: '/admin/users', title: 'Пользователи', note: 'Учётные записи, роли, сброс пароля, архив', icon: 'users', group: 'access', visible: u => has(u, 'users:view') },
  { to: '/access', title: 'Роли и доступы', note: 'Права ролей и личные исключения', icon: 'shield', group: 'access', visible: u => u.role === 'admin' },
  { to: '/admin/divisions', title: 'Оргструктура', note: 'Подразделения, ответственные, направления', icon: 'units', group: 'structure', visible: u => has(u, 'divisions:view') },
  { to: '/admin/staff', title: 'Справочник сотрудников', note: 'Штат из 1С — импорт и правка', icon: 'book', group: 'structure', visible: u => has(u, 'dictionary:view') },
  { to: '/admin/dictionary', title: 'Справочники', note: 'Компании, должности, сегменты, регионы — правка и объединение дублей', icon: 'dict', group: 'structure', visible: u => has(u, 'dictionary:view') },
  { to: '/admin/grading', title: 'Грейдирование — настройка', note: 'Формулировки анкеты, блоки, комиссия', icon: 'grades', group: 'method', visible: u => has(u, 'grading:factors') || has(u, 'grading:blocks') || has(u, 'grading:committee') },
  { to: '/admin/benchmark', title: 'Бенчмаркинг', note: 'Импорт источников и сопоставление позиций', icon: 'chart', group: 'method', visible: u => has(u, 'benchmarks:import') || has(u, 'benchmarks:map') },
  { to: '/admin/periods', title: 'Периоды сбора', note: 'Открытие/закрытие периода, доступ к архиву', icon: 'clock', group: 'process', visible: u => has(u, 'period:view') },
  { to: '/admin/support', title: 'Чат поддержки', note: 'Инбокс, привязка к сотруднику, готовые фразы', icon: 'chat', group: 'process', visible: u => has(u, 'support:manage') },
  { to: '/admin/broadcast', title: 'Рассылка', note: 'Сообщение через Telegram-бота выбранным сотрудникам', icon: 'send', group: 'process', visible: u => has(u, 'broadcast:send') },
  { to: '/admin/audit-log', title: 'Журнал изменений', note: 'Кто, когда и что сделал в администрировании', icon: 'log', group: 'process', visible: u => has(u, 'service:view') },
  { to: '/admin/service', title: 'Обслуживание и статус данных', note: 'Счётчики загруженных данных, сервисные задачи, импорт анкеты из CSV', icon: 'tools', group: 'process', visible: u => has(u, 'service:view') },
  { to: '/admin/comp-committee', title: 'Пересмотр ЗП — комиссия', note: 'Состав комиссии, режим голосования', icon: 'money', group: 'process', visible: u => has(u, 'comp:admin') }
];

function has(u: SessionUser, c: string) {
  return u.role === 'admin' || u.capabilities.includes(c);
}

function AdminGroupBlock({ groupKey, sections, badges }: { groupKey: GroupKey; sections: Section[]; badges: Record<string, number> }) {
  const storageKey = `admin-group-${groupKey}`;
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(storageKey) !== '0'; } catch { return true; }
  });

  function toggle() {
    setExpanded(v => {
      const next = !v;
      try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }

  return (
    <div className={s.group}>
      <button type="button" className={s.groupHead} onClick={toggle} aria-expanded={expanded}>
        <span className={s.groupLabel}>{GROUP_LABEL[groupKey]}</span>
        <span className={[s.groupChevron, expanded ? s.groupChevronOpen : ''].join(' ')} aria-hidden="true">›</span>
      </button>
      {expanded && (
        <div className={s.grid}>
          {sections.map(sec => (
            <Link key={sec.to} to={sec.to} className={s.card}>
              <span className={s.cardIcon}><Icon name={sec.icon} /></span>
              <span>
                <div className={s.cardTitle}>
                  {sec.title}
                  {!!badges[sec.to] && <> <Badge tone="warn">{badges[sec.to] > 99 ? '99+' : badges[sec.to]}</Badge></>}
                </div>
                <div className={s.cardNote}>{sec.note}</div>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminHub() {
  useScreenTitle('Администрирование');
  const { user } = useSessionData();
  const support = useSupportUnreadCount();
  const badges: Record<string, number> = { '/admin/support': support.count };
  const visible = SECTIONS.filter(sec => sec.visible(user));
  const groups = GROUP_ORDER
    .map(key => ({ key, sections: visible.filter(sec => sec.group === key) }))
    .filter(g => g.sections.length > 0);

  return (
    <div className={s.groupList}>
      {groups.map(g => <AdminGroupBlock key={g.key} groupKey={g.key} sections={g.sections} badges={badges} />)}
      {!visible.length && <p className={s.empty}>Нет доступных разделов администрирования.</p>}
    </div>
  );
}
