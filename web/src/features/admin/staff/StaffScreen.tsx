import { useMemo, useState } from 'react';
import type { StaffRecord } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { ActiveTableFilterChips, TableFiltersButton } from '../../../design/TableFilters';
import { useSort } from '../../../design/useSort';
import type { TableFilterField } from '../../../design/useTableFilters';
import { useTableFilters } from '../../../design/useTableFilters';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { StaffImportWizard } from './StaffImportWizard';
import { useStaff } from './useStaff';

export function StaffScreen() {
  useScreenTitle('Справочник сотрудников');
  const st = useStaff();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<StaffRecord | 'new' | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const unitOptions = useMemo(() => {
    const set = new Set<string>();
    (st.items ?? []).forEach(r => { if (r.unit) set.add(r.unit); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [st.items]);

  const filterFields: TableFilterField<StaffRecord>[] = useMemo(() => [
    { key: 'unit', label: 'Подразделение', get: r => r.unit, kind: 'select', options: unitOptions },
    { key: 'position', label: 'Должность', get: r => r.position }
  ], [unitOptions]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = st.items ?? [];
    if (!q) return rows;
    return rows.filter(r => r.fio.toLowerCase().includes(q));
  }, [st.items, query]);

  const tf = useTableFilters(searched, filterFields);

  const { sorted, sortKey, sortDir, sortBy } = useSort(tf.filtered, (row, key) => {
    switch (key) {
      case 'fio': return row.fio;
      case 'unit': return row.unit;
      case 'position': return row.position;
      default: return '';
    }
  });

  if (st.listError) return <p className={s.empty}>{st.listError.message}</p>;
  if (st.listLoading) return <Skeleton lines={8} />;

  return (
    <div className={s.screenFill} data-wide>
      <div className={s.head}>
        <Input label="Поиск" placeholder="ФИО" value={query} onChange={e => setQuery(e.target.value)} />
        <TableFiltersButton f={tf} fields={filterFields} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>Импорт из 1С</Button>
          <Button size="sm" onClick={() => setEditing('new')}>Добавить</Button>
        </div>
      </div>

      <ActiveTableFilterChips f={tf} />
      <p className={s.hint}>
        {st.importedAt && <>Последний импорт: {st.importedAt} · </>}
        {tf.filtered.length === (st.items ?? []).length ? `${tf.filtered.length} записей` : `${tf.filtered.length} из ${(st.items ?? []).length} записей`}
      </p>

      <div className={[s.tableWrapFill, s.hideOnMobile].join(' ')}>
        <table className={s.table}>
          <thead>
            <tr>
              <SortTh label="ФИО" sortKey="fio" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Подразделение" sortKey="unit" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Должность" sortKey="position" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.id}>
                <td><button type="button" className={s.linkBtn} onClick={() => setEditing(row)}>{row.fio}</button></td>
                <td>{row.unit}</td>
                <td>{row.position}</td>
                <td>
                  <Button
                    size="sm" variant="danger"
                    onClick={async () => { if (await confirm({ message: `Удалить запись «${row.fio}»?`, danger: true })) st.remove(row.id); }}
                  >
                    Удалить
                  </Button>
                </td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={4} className={s.empty}>{(st.items ?? []).length ? 'Ничего не найдено' : 'Справочник пуст'}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Узкий экран: та же таблица, только без отдельной колонки под кнопку
          «Удалить» — она не помещалась бы рядом с текстом. Удаление
          переехало в форму (StaffRecordForm, кнопка снизу только при правке
          существующей записи), тот же приём, что и в «Пользователях». */}
      <div className={s.tableWrapFill}>
        <table className={s.tableCompact}>
          <thead><tr><th>ФИО</th><th>Подразделение / должность</th></tr></thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.id} className={s.clickableRow} onClick={() => setEditing(row)}>
                <td>{row.fio}</td>
                <td>{row.unit}<div className={s.hint}>{row.position}</div></td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={2} className={s.empty}>{(st.items ?? []).length ? 'Ничего не найдено' : 'Справочник пуст'}</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <StaffRecordForm
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={p => { st.save(p); setEditing(null); }}
          onDelete={editing !== 'new' ? async () => { if (await confirm({ message: `Удалить запись «${editing.fio}»?`, danger: true })) { st.remove(editing.id); setEditing(null); } } : undefined}
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

function StaffRecordForm({ record, onClose, onSubmit, onDelete }: {
  record: StaffRecord | null;
  onClose: () => void;
  onSubmit: (p: { id?: number; unit: string; fio: string; position: string }) => void;
  /** Только для правки существующей записи — на узком экране .tableCompact
      не показывает отдельную колонку под «Удалить» (см. StaffScreen.tsx),
      действие переехало сюда; на десктопе там же остаётся своя кнопка в
      строке таблицы, .mobileFormActions скрывает эту от 768px. */
  onDelete?: () => void;
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
          {onDelete && (
            <div className={s.mobileFormActions}>
              <Button size="sm" variant="danger" onClick={onDelete}>Удалить</Button>
            </div>
          )}
          <Button disabled={!unit.trim() || !fio.trim()} onClick={() => onSubmit({ id: record?.id, unit: unit.trim(), fio: fio.trim(), position: position.trim() })}>
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
