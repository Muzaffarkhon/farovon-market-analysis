import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { useSort } from '../../../design/useSort';
import s from '../Admin.module.css';
import { useDatasets } from './useBenchmarkAdmin';

export function DatasetsTab() {
  const d = useDatasets();
  const confirm = useConfirm();

  const { sorted, sortKey, sortDir, sortBy } = useSort(d.datasets ?? [], (row, key) => {
    switch (key) {
      case 'title': return row.title;
      case 'source': return row.source_title;
      case 'dataAsOf': return row.data_as_of ?? row.report_date ?? '';
      case 'rows': return row.row_count;
      case 'uploaded': return row.uploaded_at;
      default: return '';
    }
  });

  if (d.error) return <p className={s.empty}>{d.error.message}</p>;
  if (d.loading) return <Skeleton lines={4} />;

  return (
    <div className={s.tableWrapFill}>
      <table className={s.table}>
        <thead>
          <tr>
            <SortTh label="Датасет" sortKey="title" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
            <SortTh label="Источник" sortKey="source" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
            <SortTh label="Дата данных" sortKey="dataAsOf" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
            <SortTh label="Строк" sortKey="rows" activeKey={sortKey} dir={sortDir} onSort={sortBy} numeric />
            <SortTh label="Загружен" sortKey="uploaded" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.id}>
              <td>{row.title}</td>
              <td>{row.source_title}</td>
              <td>{row.data_as_of ?? row.report_date ?? '—'}</td>
              <td>{row.row_count}</td>
              <td>{row.uploaded_by} · {row.uploaded_at}</td>
              <td>
                <Button
                  size="sm" variant="danger"
                  onClick={async () => { if (await confirm({ message: `Удалить датасет «${row.title}» вместе со всеми строками?`, danger: true })) d.remove(row.id); }}
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
