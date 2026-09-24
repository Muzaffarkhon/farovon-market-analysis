import { useMemo, useState } from 'react';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { useSort } from '../../../design/useSort';
import { useScreenTitle } from '../../shell/Shell';
import { useAuditLog } from './useAuditLog';
import s from '../Admin.module.css';

const PER_PAGE = 50;

function fmtDateTime(dt: string) {
  const d = new Date(dt.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? dt : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Кто, когда и что сделал в администрировании — та же логика, что в старом клиенте (client/app.js: renderAdminAudit). */
export function AuditLogScreen() {
  useScreenTitle('Журнал изменений');
  const log = useAuditLog();
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const actions = useMemo(() => {
    const set = new Set<string>();
    log.logs.forEach(l => { if (l.action) set.add(l.action); });
    return [...set].sort();
  }, [log.logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return log.logs.filter(l => {
      const matchQ = !q || l.login.toLowerCase().includes(q) || l.detail.toLowerCase().includes(q);
      const matchA = !action || l.action === action;
      return matchQ && matchA;
    });
  }, [log.logs, query, action]);

  const { sorted, sortKey, sortDir, sortBy } = useSort(filtered, (row, key) => {
    switch (key) {
      case 'dt': return row.dt;
      case 'login': return row.login;
      case 'action': return row.action;
      case 'detail': return row.detail;
      default: return '';
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  if (log.error) return <p className={s.empty}>Не удалось загрузить журнал</p>;
  if (log.loading) return <Skeleton lines={8} />;

  return (
    <div className={s.screenFill} data-wide>
      <div className={s.head}>
        <Input label="Поиск" placeholder="По логину или деталям" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
        <Select
          label="Действие" value={action} placeholder={`Все действия (${log.logs.length})`}
          onChange={e => { setAction(e.target.value); setPage(1); }}
          options={actions.map(a => ({ value: a, label: a }))}
        />
        <Button size="sm" variant="secondary" loading={log.fetching} onClick={() => void log.refetch()}>Обновить</Button>
      </div>

      <div className={s.tableWrapFill}>
        <table className={s.table}>
          <thead>
            <tr>
              <SortTh label="Время" sortKey="dt" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Логин" sortKey="login" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Действие" sortKey="action" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Детали" sortKey="detail" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map(l => (
              <tr key={l.id}>
                <td>{fmtDateTime(l.dt)}</td>
                <td><b>{l.login}</b></td>
                <td>{l.action || '—'}</td>
                <td className={s.wrapCell}>{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sorted.length && <p className={s.empty} style={{ padding: 'var(--s-3)' }}>{log.logs.length ? 'Ничего не найдено' : 'Журнал пуст'}</p>}
      </div>

      {totalPages > 1 && (
        <div className={s.pager}>
          <Button variant="secondary" size="sm" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)}>Назад</Button>
          <span className={s.pagerInfo}>Страница {currentPage} из {totalPages} · {sorted.length} записей</span>
          <Button variant="secondary" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)}>Вперёд</Button>
        </div>
      )}
    </div>
  );
}
