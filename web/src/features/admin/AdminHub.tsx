import { Link } from 'react-router';
import type { SessionUser } from '../../api/contract';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import s from './Admin.module.css';

type Section = { to: string; title: string; note: string; visible: (u: SessionUser) => boolean };

const SECTIONS: Section[] = [
  { to: '/admin/users', title: 'Пользователи', note: 'Учётные записи, роли, сброс пароля, архив', visible: u => has(u, 'users:view') },
  { to: '/admin/divisions', title: 'Оргструктура', note: 'Подразделения, ответственные, направления', visible: u => has(u, 'divisions:view') },
  { to: '/admin/staff', title: 'Справочник сотрудников', note: 'Штат из 1С — импорт и правка', visible: u => has(u, 'dictionary:view') },
  { to: '/admin/grading', title: 'Грейдирование — настройка', note: 'Формулировки анкеты, блоки, комиссия', visible: u => has(u, 'grading:factors') || has(u, 'grading:blocks') || has(u, 'grading:committee') },
  { to: '/admin/benchmark', title: 'Бенчмаркинг', note: 'Импорт источников и сопоставление позиций', visible: u => has(u, 'benchmarks:import') || has(u, 'benchmarks:map') },
  { to: '/admin/periods', title: 'Периоды сбора', note: 'Открытие/закрытие периода, доступ к архиву', visible: u => has(u, 'period:view') },
  { to: '/access', title: 'Роли и доступы', note: 'Права ролей и личные исключения', visible: u => u.role === 'admin' }
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
          <div className={s.cardTitle}>{sec.title}</div>
          <div className={s.cardNote}>{sec.note}</div>
        </Link>
      ))}
      {!visible.length && <p className={s.empty}>Нет доступных разделов администрирования.</p>}
    </div>
  );
}
