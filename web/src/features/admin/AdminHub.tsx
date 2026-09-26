import { useState } from 'react';
import { Link } from 'react-router';
import type { SessionUser } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { Icon, type IconName } from '../../design/Icon';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import { useSupportUnreadCount } from './support/useSupportUnreadCount';
import s from './Admin.module.css';

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
  { to: '/admin/comp-committee', title: 'Изменение ЗП', note: 'Состав комиссии, режим голосования', icon: 'money', group: 'process', visible: u => has(u, 'comp:admin') }
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
