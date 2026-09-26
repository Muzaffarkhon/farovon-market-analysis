import { useState } from 'react';
import type { BenchmarkSource } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { useSort } from '../../../design/useSort';
import s from '../Admin.module.css';
import { useSources } from './useBenchmarkAdmin';

const KINDS = [
  { value: 'consultancy', label: 'Консалтинг' },
  { value: 'survey', label: 'Опрос рынка' },
  { value: 'internal', label: 'Внутренний сбор' },
  { value: 'other', label: 'Другое' }
];

export function SourcesTab() {
  const src = useSources();
  const [editing, setEditing] = useState<BenchmarkSource | 'new' | null>(null);

  const { sorted, sortKey, sortDir, sortBy } = useSort(src.sources ?? [], (row, key) => {
    switch (key) {
      case 'title': return row.title;
      case 'kind': return KINDS.find(k => k.value === row.kind)?.label ?? row.kind;
      case 'currency': return row.default_currency;
      case 'licensed': return row.is_licensed ? 1 : 0;
      case 'weight': return row.weight;
      case 'hidden': return row.hidden ? 1 : 0;
      default: return '';
    }
  });

  if (src.error) return <p className={s.empty}>{src.error.message}</p>;
  if (src.loading) return <Skeleton lines={4} />;

  return (
    <div className={s.screenFill}>
      <div className={s.head}>
        <Button size="sm" onClick={() => setEditing('new')}>Новый источник</Button>
      </div>
      <div className={[s.tableWrapFill, s.hideOnMobile].join(' ')}>
        <table className={s.table}>
          <thead>
            <tr>
              <SortTh label="Название" sortKey="title" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Тип" sortKey="kind" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Валюта" sortKey="currency" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Лицензия" sortKey="licensed" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Вес" sortKey="weight" activeKey={sortKey} dir={sortDir} onSort={sortBy} numeric />
              <SortTh label="Скрыт" sortKey="hidden" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.key} className={s.clickableRow} onClick={() => setEditing(row)}>
                <td>{row.title}</td>
                <td>{KINDS.find(k => k.value === row.kind)?.label ?? row.kind}</td>
                <td>{row.default_currency}</td>
                <td>{row.is_licensed ? 'да' : ''}</td>
                <td>{row.weight}</td>
                <td>{row.hidden ? 'да' : ''}</td>
                <td onClick={e => e.stopPropagation()}>
                  {row.key !== 'internal' && (
                    <Button size="sm" variant="secondary" onClick={() => src.update({ key: row.key, hidden: !row.hidden })}>
                      {row.hidden ? 'Показать' : 'Скрыть'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Узкий экран: название и тип, остальное (валюта/лицензия/вес/скрыт)
          и переключатель «Скрыть/Показать» — в форме редактирования. */}
      <div className={s.tableWrapFill}>
        <table className={s.tableCompact}>
          <thead><tr><th>Название</th><th>Тип</th></tr></thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.key} className={s.clickableRow} onClick={() => setEditing(row)}>
                <td>{row.title}</td>
                <td>{KINDS.find(k => k.value === row.kind)?.label ?? row.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing === 'new' && (
        <CreateSourceForm onClose={() => setEditing(null)} onSubmit={p => { src.create(p); setEditing(null); }} />
      )}
      {editing && editing !== 'new' && (
        <EditSourceForm
          source={editing}
          onClose={() => setEditing(null)}
          onSubmit={p => { src.update(p); setEditing(null); }}
          onToggleHidden={editing.key !== 'internal' ? () => { src.update({ key: editing.key, hidden: !editing.hidden }); setEditing(null); } : undefined}
        />
      )}
    </div>
  );
}

function CreateSourceForm({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (p: { key: string; title: string; kind: string; isLicensed: boolean; defaultCurrency: string; notes: string }) => void;
}) {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('consultancy');
  const [isLicensed, setIsLicensed] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState('сомони');
  const [notes, setNotes] = useState('');

  return (
    <Sheet open onClose={onClose} title="Новый источник данных">
      <div className={s.form}>
        <Input label="Код источника" value={key} onChange={e => setKey(e.target.value)} hint="Латиницей, без пробелов" />
        <Input label="Название" value={title} onChange={e => setTitle(e.target.value)} />
        <Select label="Тип" value={kind} onChange={e => setKind(e.target.value)} options={KINDS} />
        <Input label="Валюта по умолчанию" value={defaultCurrency} onChange={e => setDefaultCurrency(e.target.value)} />
        <label className={s.unitRow}>
          <input type="checkbox" checked={isLicensed} onChange={e => setIsLicensed(e.target.checked)} /> Лицензированный источник
        </label>
        <Input label="Примечание" value={notes} onChange={e => setNotes(e.target.value)} />
        <div className={s.formFoot}>
          <Button disabled={!key.trim() || !title.trim()} onClick={() => onSubmit({ key: key.trim(), title: title.trim(), kind, isLicensed, defaultCurrency, notes })}>
            Создать
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function EditSourceForm({ source, onClose, onSubmit, onToggleHidden }: {
  source: BenchmarkSource;
  onClose: () => void;
  onSubmit: (p: { key: string; title: string; kind: string; defaultCurrency: string; isLicensed: boolean; notes: string }) => void;
  /** Только на узком экране — на десктопе переключатель остаётся в строке
      таблицы (SourcesTab.tsx, .tableWrapFill без .hideOnMobile). */
  onToggleHidden?: () => void;
}) {
  const [title, setTitle] = useState(source.title);
  const [kind, setKind] = useState(source.kind);
  const [defaultCurrency, setDefaultCurrency] = useState(source.default_currency);
  const [isLicensed, setIsLicensed] = useState(!!source.is_licensed);
  const [notes, setNotes] = useState(source.notes);

  return (
    <Sheet open onClose={onClose} title={source.title}>
      <div className={s.form}>
        <Input label="Название" value={title} onChange={e => setTitle(e.target.value)} />
        <Select label="Тип" value={kind} onChange={e => setKind(e.target.value)} options={KINDS} />
        <Input label="Валюта по умолчанию" value={defaultCurrency} onChange={e => setDefaultCurrency(e.target.value)} />
        <label className={s.unitRow}>
          <input type="checkbox" checked={isLicensed} onChange={e => setIsLicensed(e.target.checked)} /> Лицензированный источник
        </label>
        <Input label="Примечание" value={notes} onChange={e => setNotes(e.target.value)} />
        <div className={s.formFoot}>
          {onToggleHidden && (
            <div className={s.mobileFormActions}>
              <Button size="sm" variant="secondary" onClick={onToggleHidden}>{source.hidden ? 'Показать' : 'Скрыть'}</Button>
            </div>
          )}
          <Button onClick={() => onSubmit({ key: source.key, title, kind, defaultCurrency, isLicensed, notes })}>Сохранить</Button>
        </div>
      </div>
    </Sheet>
  );
}
