import { useState } from 'react';
import type { AdminUser } from '../../../api/contract';
import { Badge } from '../../../design/Badge';
import { Button } from '../../../design/Button';
import { Chip } from '../../../design/Chip';
import { Skeleton } from '../../../design/Skeleton';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { UserForm } from './UserForm';
import { useUsers } from './useUsers';

export function UsersScreen() {
  useScreenTitle('Пользователи');
  const u = useUsers();
  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);

  if (u.usersError) return <p className={s.empty}>{u.usersError.message}</p>;
  if (u.usersLoading) return <Skeleton lines={6} />;

  const formOpen = creating || !!editing;

  return (
    <div className={s.screenFill}>
      <div className={s.head}>
        <div className={s.tabs}>
          <Chip active={tab === 'active'} onClick={() => setTab('active')}>Активные</Chip>
          <Chip active={tab === 'archive'} onClick={() => setTab('archive')}>Архив</Chip>
        </div>
        {tab === 'active' && <Button size="sm" onClick={() => setCreating(true)}>Добавить</Button>}
      </div>

      {tab === 'active' && (
        <div className={s.tableWrapFill}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>ФИО</th><th>Логин</th><th>Роль</th><th>Подразделения</th><th>Телефон</th>
                <th>Должность</th><th>Статус</th><th>Telegram</th><th>Последний вход</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(u.users ?? []).map(row => (
                <tr key={row.id} className={row.active ? '' : s.rowInactive}>
                  <td><button type="button" className={s.linkBtn} onClick={() => setEditing(row)}>{row.fio}</button></td>
                  <td>{row.login}</td>
                  <td>{row.role}</td>
                  <td>{row.units.join(', ')}</td>
                  <td>{row.phone}</td>
                  <td>{row.position}</td>
                  <td>
                    <label>
                      <input
                        type="checkbox" checked={row.active}
                        onChange={e => {
                          if (!e.target.checked && !confirm(`Выключить доступ пользователю «${row.fio}»?`)) return;
                          u.toggle({ login: row.login, active: e.target.checked });
                        }}
                      /> {row.active ? 'активен' : 'выключен'}
                    </label>
                  </td>
                  <td>{row.hasTelegram ? <Badge tone="ok">есть</Badge> : <Badge tone="muted">нет</Badge>}</td>
                  <td>{row.lastIn || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <Button
                      size="sm" variant="secondary"
                      onClick={() => { if (confirm(`Сбросить пароль пользователю «${row.fio}»? Новый пароль придёт ему в Telegram.`)) u.resetPassword(row.login); }}
                    >
                      Сброс пароля
                    </Button>
                    <Button
                      size="sm" variant="danger"
                      onClick={() => { if (confirm(`Переместить «${row.fio}» в архив?`)) u.archiveUser(row.login); }}
                    >
                      В архив
                    </Button>
                  </td>
                </tr>
              ))}
              {!u.users?.length && <tr><td colSpan={10} className={s.empty}>Пользователей нет</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'archive' && (
        <div className={s.tableWrapFill}>
          <table className={s.table}>
            <thead><tr><th>ФИО</th><th>Логин</th><th>Роль</th><th>В архиве с</th><th></th></tr></thead>
            <tbody>
              {(u.archived ?? []).map(row => (
                <tr key={row.id}>
                  <td>{row.fio}</td><td>{row.login}</td><td>{row.role}</td><td>{row.archivedAt}</td>
                  <td><Button size="sm" variant="secondary" onClick={() => u.restoreUser(row.login)}>Восстановить</Button></td>
                </tr>
              ))}
              {!u.archived?.length && <tr><td colSpan={5} className={s.empty}>Архив пуст</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <UserForm
          editing={editing}
          roles={u.roles ?? []}
          unitOptions={u.unitOptions}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSubmit={p => { u.save(p); setEditing(null); setCreating(false); }}
          submitting={u.saving}
        />
      )}

    </div>
  );
}
