import { useState } from 'react';
import type { BenchmarkSource } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
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

  if (src.error) return <p className={s.empty}>{src.error.message}</p>;
  if (src.loading) return <Skeleton lines={4} />;

  return (
    <div className={s.screenFill}>
      <div className={s.head}>
        <Button size="sm" onClick={() => setEditing('new')}>Новый источник</Button>
      </div>
      <div className={s.tableWrapFill}>
        <table className={s.table}>
          <thead><tr><th>Название</th><th>Тип</th><th>Валюта</th><th>Лицензия</th><th>Вес</th><th>Скрыт</th><th></th></tr></thead>
          <tbody>
            {(src.sources ?? []).map(row => (
              <tr key={row.key}>
                <td><button type="button" className={s.linkBtn} onClick={() => setEditing(row)}>{row.title}</button></td>
                <td>{KINDS.find(k => k.value === row.kind)?.label ?? row.kind}</td>
                <td>{row.default_currency}</td>
                <td>{row.is_licensed ? 'да' : ''}</td>
                <td>{row.weight}</td>
                <td>{row.hidden ? 'да' : ''}</td>
                <td>
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

      {editing === 'new' && (
        <CreateSourceForm onClose={() => setEditing(null)} onSubmit={p => { src.create(p); setEditing(null); }} />
      )}
      {editing && editing !== 'new' && (
        <EditSourceForm source={editing} onClose={() => setEditing(null)} onSubmit={p => { src.update(p); setEditing(null); }} />
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

function EditSourceForm({ source, onClose, onSubmit }: {
  source: BenchmarkSource;
  onClose: () => void;
  onSubmit: (p: { key: string; title: string; kind: string; defaultCurrency: string; isLicensed: boolean; notes: string }) => void;
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
          <Button onClick={() => onSubmit({ key: source.key, title, kind, defaultCurrency, isLicensed, notes })}>Сохранить</Button>
        </div>
      </div>
    </Sheet>
  );
}
