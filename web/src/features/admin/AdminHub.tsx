import { Link } from 'react-router';
import type { SessionUser } from '../../api/contract';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import s from './Admin.module.css';

type IconName = 'users' | 'units' | 'book' | 'grades' | 'chart' | 'clock' | 'chat' | 'shield';
type Section = { to: string; title: string; note: string; icon: IconName; visible: (u: SessionUser) => boolean };

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
  shield: '<path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 12.2l2 2 3.6-3.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }} />
  );
}

const SECTIONS: Section[] = [
  { to: '/admin/users', title: 'Пользователи', note: 'Учётные записи, роли, сброс пароля, архив', icon: 'users', visible: u => has(u, 'users:view') },
  { to: '/admin/divisions', title: 'Оргструктура', note: 'Подразделения, ответственные, направления', icon: 'units', visible: u => has(u, 'divisions:view') },
  { to: '/admin/staff', title: 'Справочник сотрудников', note: 'Штат из 1С — импорт и правка', icon: 'book', visible: u => has(u, 'dictionary:view') },
  { to: '/admin/grading', title: 'Грейдирование — настройка', note: 'Формулировки анкеты, блоки, комиссия', icon: 'grades', visible: u => has(u, 'grading:factors') || has(u, 'grading:blocks') || has(u, 'grading:committee') },
  { to: '/admin/benchmark', title: 'Бенчмаркинг', note: 'Импорт источников и сопоставление позиций', icon: 'chart', visible: u => has(u, 'benchmarks:import') || has(u, 'benchmarks:map') },
  { to: '/admin/periods', title: 'Периоды сбора', note: 'Открытие/закрытие периода, доступ к архиву', icon: 'clock', visible: u => has(u, 'period:view') },
  { to: '/admin/support', title: 'Чат поддержки', note: 'Инбокс, привязка к сотруднику, готовые фразы', icon: 'chat', visible: u => has(u, 'support:manage') },
  { to: '/access', title: 'Роли и доступы', note: 'Права ролей и личные исключения', icon: 'shield', visible: u => u.role === 'admin' }
];

function has(u: SessionUser, c: string) {
  return u.role === 'admin' || u.capabilities.includes(c);
}

export function AdminHub() {
  useScreenTitle('Администрирование');
  const { user } = useSessionData();
  const visible = SECTIONS.filter(sec => sec.visible(user));

  return (
    <div className={s.grid}>
      {visible.map(sec => (
        <Link key={sec.to} to={sec.to} className={s.card}>
          <span className={s.cardIcon}><Icon name={sec.icon} /></span>
          <span>
            <div className={s.cardTitle}>{sec.title}</div>
            <div className={s.cardNote}>{sec.note}</div>
          </span>
        </Link>
      ))}
      {!visible.length && <p className={s.empty}>Нет доступных разделов администрирования.</p>}
    </div>
  );
}
