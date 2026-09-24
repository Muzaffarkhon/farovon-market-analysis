import { useMemo, useState } from 'react';
import type { AdminUser } from '../../../api/contract';
import { Badge } from '../../../design/Badge';
import { Button } from '../../../design/Button';
import { Chip } from '../../../design/Chip';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { ActiveTableFilterChips, TableFiltersButton } from '../../../design/TableFilters';
import { useSort } from '../../../design/useSort';
import type { TableFilterField } from '../../../design/useTableFilters';
import { useTableFilters } from '../../../design/useTableFilters';
import { useSessionData } from '../../auth/useSession';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { UserForm } from './UserForm';
import { useUsers } from './useUsers';

export function UsersScreen() {
  useScreenTitle('Пользователи');
  const u = useUsers();
  const { user } = useSessionData();
  const confirm = useConfirm();
  // Добавлять новых пользователей может только встроенный суперадмин (login
  // «admin») — см. adminController.saveUser. У остальных, даже с ролью
  // admin, сервер отклонит запрос, поэтому кнопку им не показываем.
  const canCreate = user.login.toLowerCase() === 'admin';
  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);

  const roles = u.roles;

  // Одно поле фильтра на каждый столбец таблицы (кроме статуса/действий,
  // у которых уже есть свой чекбокс/кнопки в строке) — тот же приём, что в
  // реестре (RegistryFilters), а не общий поиск или один произвольный список.
  const filterFields: TableFilterField<AdminUser>[] = useMemo(() => [
    { key: 'role', label: 'Роль', get: r => roles?.find(x => x.key === r.role)?.label ?? r.role, kind: 'select' },
    { key: 'units', label: 'Подразделения', get: r => r.units.join(', ') },
    { key: 'phone', label: 'Телефон', get: r => r.phone },
    { key: 'position', label: 'Должность', get: r => r.position },
    { key: 'status', label: 'Статус', get: r => r.active ? 'активен' : 'выключен', kind: 'select' },
    { key: 'telegram', label: 'Telegram', get: r => r.hasTelegram ? 'есть' : 'нет', kind: 'select' }
  ], [roles]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = u.users ?? [];
    if (!q) return rows;
    return rows.filter(r => r.fio.toLowerCase().includes(q) || r.login.toLowerCase().includes(q));
  }, [u.users, query]);

  const tf = useTableFilters(searched, filterFields);

  const activeSort = useSort(tf.filtered, (row, key) => {
    switch (key) {
      case 'fio': return row.fio;
      case 'login': return row.login;
      case 'role': return row.role;
      case 'units': return row.units.join(', ');
      case 'phone': return row.phone;
      case 'position': return row.position;
      case 'status': return row.active ? 1 : 0;
      case 'telegram': return row.hasTelegram ? 1 : 0;
      case 'lastIn': return row.lastIn ?? '';
      default: return '';
    }
  });

  const archivedSort = useSort(u.archived ?? [], (row, key) => {
    switch (key) {
      case 'fio': return row.fio;
      case 'login': return row.login;
      case 'role': return row.role;
      case 'archivedAt': return row.archivedAt;
      default: return '';
    }
  });

  if (u.usersError) return <p className={s.empty}>{u.usersError.message}</p>;
  if (u.usersLoading) return <Skeleton lines={6} />;

  const formOpen = creating || !!editing;

  return (
    <div className={s.screenFill} data-wide>
      <div className={s.head} style={{ marginBottom: 0 }}>
        <div className={s.tabs}>
          <Chip active={tab === 'active'} onClick={() => setTab('active')}>Активные</Chip>
          <Chip active={tab === 'archive'} onClick={() => setTab('archive')}>Архив</Chip>
        </div>
        {tab === 'active' && (
          <>
            <div style={{ flex: '1 1 200px', minWidth: 200 }}>
              <Input label="" aria-label="Поиск" placeholder="ФИО или логин" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <TableFiltersButton f={tf} fields={filterFields} />
          </>
        )}
        {tab === 'active' && canCreate && <Button size="sm" onClick={() => setCreating(true)}>Добавить</Button>}
      </div>

      {tab === 'active' && (
        <>
          <ActiveTableFilterChips f={tf} />
          <div className={s.hint} style={{ margin: 0 }}>
            {tf.filtered.length === (u.users ?? []).length ? `${tf.filtered.length} записей` : `${tf.filtered.length} из ${(u.users ?? []).length} записей`}
          </div>
        </>
      )}

      {tab === 'active' && (
        <div className={s.tableWrapFill}>
          <table className={s.table}>
            <thead>
              <tr>
                <SortTh label="ФИО" sortKey="fio" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Логин" sortKey="login" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Роль" sortKey="role" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Подразделения" sortKey="units" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Телефон" sortKey="phone" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Должность" sortKey="position" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Статус" sortKey="status" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Telegram" sortKey="telegram" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <SortTh label="Последний вход" sortKey="lastIn" activeKey={activeSort.sortKey} dir={activeSort.sortDir} onSort={activeSort.sortBy} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activeSort.sorted.map(row => (
                <tr key={row.id} className={row.active ? '' : s.rowInactive}>
                  <td><button type="button" className={s.linkBtn} onClick={() => setEditing(row)}>{row.fio}</button></td>
                  <td>{row.login}</td>
                  <td>{row.role}</td>
                  <td className={s.wrapCell} title={row.units.join('\n')}>
                    {row.units.length > 3 ? `${row.units.slice(0, 3).join(', ')} и ещё ${row.units.length - 3}` : row.units.join(', ')}
                  </td>
                  <td>{row.phone}</td>
                  <td>{row.position}</td>
                  <td>
                    <label>
                      <input
                        type="checkbox" checked={row.active}
                        onChange={async e => {
                          const nextActive = e.target.checked;
                          if (!nextActive && !(await confirm({ message: `Выключить доступ пользователю «${row.fio}»?`, danger: true }))) return;
                          u.toggle({ login: row.login, active: nextActive });
                        }}
                      /> {row.active ? 'активен' : 'выключен'}
                    </label>
                  </td>
                  <td>{row.hasTelegram ? <Badge tone="ok">есть</Badge> : <Badge tone="muted">нет</Badge>}</td>
                  <td>{row.lastIn || '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <Button
                      size="sm" variant="secondary"
                      onClick={async () => { if (await confirm(`Сбросить пароль пользователю «${row.fio}»? Новый пароль придёт ему в Telegram.`)) u.resetPassword(row.login); }}
                    >
                      Сброс пароля
                    </Button>
                    <Button
                      size="sm" variant="danger"
                      onClick={async () => { if (await confirm({ message: `Переместить «${row.fio}» в архив?`, danger: true })) u.archiveUser(row.login); }}
                    >
                      В архив
                    </Button>
                  </td>
                </tr>
              ))}
              {!activeSort.sorted.length && <tr><td colSpan={10} className={s.empty}>{(u.users ?? []).length ? 'Ничего не найдено' : 'Пользователей нет'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'archive' && (
        <div className={s.tableWrapFill}>
          <table className={s.table}>
            <thead>
              <tr>
                <SortTh label="ФИО" sortKey="fio" activeKey={archivedSort.sortKey} dir={archivedSort.sortDir} onSort={archivedSort.sortBy} />
                <SortTh label="Логин" sortKey="login" activeKey={archivedSort.sortKey} dir={archivedSort.sortDir} onSort={archivedSort.sortBy} />
                <SortTh label="Роль" sortKey="role" activeKey={archivedSort.sortKey} dir={archivedSort.sortDir} onSort={archivedSort.sortBy} />
                <SortTh label="В архиве с" sortKey="archivedAt" activeKey={archivedSort.sortKey} dir={archivedSort.sortDir} onSort={archivedSort.sortBy} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {archivedSort.sorted.map(row => (
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
