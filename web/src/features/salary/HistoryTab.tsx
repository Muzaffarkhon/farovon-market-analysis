import { useMemo, useState } from 'react';
import { Input } from '../../design/Input';
import { Skeleton } from '../../design/Skeleton';
import { useSalaryHistory } from './useSalary';
import s from './Salary.module.css';

const fmt = new Intl.NumberFormat('ru-RU');

export function HistoryTab() {
  const h = useSalaryHistory();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return h.rows;
    return h.rows.filter(r => r.fio.toLowerCase().includes(q) || r.unit.toLowerCase().includes(q));
  }, [h.rows, query]);

  if (h.loading) return <Skeleton lines={6} />;

  return (
    <div>
      <Input label="Поиск" placeholder="ФИО или подразделение" value={query} onChange={e => setQuery(e.target.value)} />
      <div className={s.tableWrap} style={{ marginTop: 'var(--s-3)' }}>
        <table className={s.table}>
          <thead>
            <tr><th>Сотрудник</th><th>Подразделение</th><th className={s.num}>Было</th><th className={s.num}>Стало</th><th>Дата</th></tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}>
                <td>{r.fio}</td>
                <td>{r.unit}</td>
                <td className={s.num}>{r.old_salary != null ? fmt.format(r.old_salary) : '—'}</td>
                <td className={s.num}><b>{fmt.format(r.new_salary)}</b></td>
                <td>{new Date(r.changed_at.replace(' ', 'T')).toLocaleDateString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className={s.empty} style={{ padding: 'var(--s-3)' }}>{h.rows.length ? 'Ничего не найдено' : 'Изменений пока не было'}</p>}
      </div>
    </div>
  );
}
