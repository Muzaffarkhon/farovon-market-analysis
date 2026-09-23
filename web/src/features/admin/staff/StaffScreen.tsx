import { useMemo, useState } from 'react';
import type { StaffRecord } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { StaffImportWizard } from './StaffImportWizard';
import { useStaff } from './useStaff';

export function StaffScreen() {
  useScreenTitle('Справочник сотрудников');
  const st = useStaff();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<StaffRecord | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = st.items ?? [];
    if (!q) return rows;
    return rows.filter(r => r.fio.toLowerCase().includes(q) || r.unit.toLowerCase().includes(q));
  }, [st.items, query]);

  if (st.listError) return <p className={s.empty}>{st.listError.message}</p>;
  if (st.listLoading) return <Skeleton lines={8} />;

  return (
    <div>
      <div className={s.head}>
        <Input label="Поиск" placeholder="ФИО или подразделение" value={query} onChange={e => setQuery(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>Импорт из 1С</Button>
          <Button size="sm" onClick={() => setEditing('new')}>Добавить</Button>
        </div>
      </div>

      {st.importedAt && <p className={s.hint}>Последний импорт: {st.importedAt}</p>}

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>ФИО</th><th>Подразделение</th><th>Должность</th><th></th></tr></thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.id}>
                <td><button type="button" className={s.linkBtn} onClick={() => setEditing(row)}>{row.fio}</button></td>
                <td>{row.unit}</td>
                <td>{row.position}</td>
                <td>
                  <Button
                    size="sm" variant="danger"
                    onClick={() => { if (confirm(`Удалить запись «${row.fio}»?`)) st.remove(row.id); }}
                  >
                    Удалить
                  </Button>
                </td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={4} className={s.empty}>Справочник пуст</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <StaffRecordForm
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={p => { st.save(p); setEditing(null); }}
        />
      )}

      {importOpen && (
        <StaffImportWizard
          onClose={() => setImportOpen(false)}
          onDryRun={st.dryRun}
          onCommit={csv => { st.commit(csv); setImportOpen(false); }}
          committing={st.committing}
        />
      )}
    </div>
  );
}

function StaffRecordForm({ record, onClose, onSubmit }: {
  record: StaffRecord | null;
  onClose: () => void;
  onSubmit: (p: { id?: number; unit: string; fio: string; position: string }) => void;
}) {
  const [unit, setUnit] = useState(record?.unit ?? '');
  const [fio, setFio] = useState(record?.fio ?? '');
  const [position, setPosition] = useState(record?.position ?? '');

  return (
    <Sheet open onClose={onClose} title={record ? record.fio : 'Новая запись'}>
      <div className={s.form}>
        <Input label="Подразделение" value={unit} onChange={e => setUnit(e.target.value)} />
        <Input label="ФИО" value={fio} onChange={e => setFio(e.target.value)} />
        <Input label="Должность" value={position} onChange={e => setPosition(e.target.value)} />
        <div className={s.formFoot}>
          <Button disabled={!unit.trim() || !fio.trim()} onClick={() => onSubmit({ id: record?.id, unit: unit.trim(), fio: fio.trim(), position: position.trim() })}>
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
