import { Button } from '../../../design/Button';
import { Skeleton } from '../../../design/Skeleton';
import s from '../Admin.module.css';
import { useDatasets } from './useBenchmarkAdmin';

export function DatasetsTab() {
  const d = useDatasets();

  if (d.error) return <p className={s.empty}>{d.error.message}</p>;
  if (d.loading) return <Skeleton lines={4} />;

  return (
    <div className={s.tableWrapFill}>
      <table className={s.table}>
        <thead><tr><th>Датасет</th><th>Источник</th><th>Дата данных</th><th>Строк</th><th>Загружен</th><th></th></tr></thead>
        <tbody>
          {(d.datasets ?? []).map(row => (
            <tr key={row.id}>
              <td>{row.title}</td>
              <td>{row.source_title}</td>
              <td>{row.data_as_of ?? row.report_date ?? '—'}</td>
              <td>{row.row_count}</td>
              <td>{row.uploaded_by} · {row.uploaded_at}</td>
              <td>
                <Button
                  size="sm" variant="danger"
                  onClick={() => { if (confirm(`Удалить датасет «${row.title}» вместе со всеми строками?`)) d.remove(row.id); }}
                >
                  Удалить
                </Button>
              </td>
            </tr>
          ))}
          {!d.datasets?.length && <tr><td colSpan={6} className={s.empty}>Датасетов пока нет</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
