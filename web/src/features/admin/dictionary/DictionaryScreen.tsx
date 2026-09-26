import { useMemo, useState } from 'react';
import type { DictCompanyItem, DictItem, DictKind, DictPositionItem } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Chip } from '../../../design/Chip';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import { Combobox } from '../../../design/Combobox';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import { ActiveTableFilterChips, TableFiltersButton } from '../../../design/TableFilters';
import type { TableFilterField } from '../../../design/useTableFilters';
import { useTableFilters } from '../../../design/useTableFilters';
import { useSessionData } from '../../auth/useSession';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { MergeDuplicates } from './MergeDuplicates';
import { useDictionary } from './useDictionary';

const KINDS: { id: DictKind; label: string; one: string }[] = [
  { id: 'companies', label: 'Компании', one: 'компанию' },
  { id: 'positions', label: 'Должности', one: 'должность' },
  { id: 'segments', label: 'Сегменты', one: 'сегмент' },
  { id: 'regions', label: 'Регионы', one: 'регион' }
];

function has(u: { role: string; capabilities: string[] }, c: string) {
  return u.role === 'admin' || u.capabilities.includes(c);
}
function isCompany(it: DictItem): it is DictCompanyItem { return 'segment' in it; }
function isPosition(it: DictItem): it is DictPositionItem { return 'payFrom' in it; }

export function DictionaryScreen() {
  useScreenTitle('Справочники');
  const { user } = useSessionData();
  const canEdit = has(user, 'dictionary:edit');
  const canCreate = has(user, 'dictionary:create');
  const canMerge = has(user, 'service:edit');

  const [kind, setKind] = useState<DictKind>('companies');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DictItem | 'new' | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const confirm = useConfirm();

  const dict = useDictionary(kind);
  // Сегменты/регионы — справочник сам по себе, но ещё и источник вариантов
  // при заполнении карточки компании (picker вместо свободного ввода —
  // иначе снова разъедутся варианты написания одного и того же значения).
  const segmentsDict = useDictionary('segments');
  const regionsDict = useDictionary('regions');

  const meta = KINDS.find(k => k.id === kind)!;

  // Поля фильтра — свои для каждого справочника (у сегментов/регионов нет
  // сегмента/региона/направлений, только «Использований»), тот же приём для
  // всех: одно поле на столбец таблицы, не общий поиск и не один список.
  const filterFields: TableFilterField<DictItem>[] = useMemo(() => {
    const fields: TableFilterField<DictItem>[] = [];
    if (kind === 'companies') {
      fields.push(
        { key: 'segment', label: 'Сегмент', get: it => (isCompany(it) ? it.segment : ''), kind: 'select' },
        { key: 'region', label: 'Регион', get: it => (isCompany(it) ? it.region : ''), kind: 'select' }
      );
    }
    if (kind === 'companies' || kind === 'positions') {
      fields.push({ key: 'dirs', label: 'Направления', get: it => ((isCompany(it) || isPosition(it)) ? it.dirs.join(', ') : ''), kind: 'select', options: dict.dirs, multi: true });
    }
    fields.push({ key: 'used', label: 'Использований', get: it => String(it.used), kind: 'numeric' });
    return fields;
  }, [kind, dict.dirs]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = dict.items ?? [];
    if (!q) return items;
    return items.filter(it => it.name.toLowerCase().includes(q));
  }, [dict.items, query]);

  const tf = useTableFilters(searched, filterFields);

  async function handleDelete(name: string) {
    const u = await dict.usage(name);
    const ok = await confirm({
      title: `Удалить «${name}»?`,
      message: u.total
        ? `Значение используется в данных: ${u.parts.join(', ')}. Эти строки будут удалены вместе с ним и не восстановятся.`
        : `Удалить «${name}» насовсем? Нигде не используется.`,
      okLabel: 'Удалить', danger: true
    });
    if (ok) dict.remove(name);
  }

  return (
    <div className={s.screenFill} data-wide>
      <div className={s.head}>
        <div className={s.tabs}>
          {KINDS.map(k => <Chip key={k.id} active={kind === k.id} onClick={() => { setKind(k.id); setQuery(''); tf.reset(); }}>{k.label}</Chip>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canMerge && (kind === 'companies' || kind === 'positions') && (
            <Button size="sm" variant="secondary" onClick={() => setMergeOpen(true)}>Объединить дубли</Button>
          )}
          {canCreate && <Button size="sm" onClick={() => setEditing('new')}>+ Добавить {meta.one}</Button>}
        </div>
      </div>

      <div className={s.head}>
        <Input label="Поиск" placeholder="Название" value={query} onChange={e => setQuery(e.target.value)} />
        <TableFiltersButton f={tf} fields={filterFields} />
      </div>
      <ActiveTableFilterChips f={tf} />
      <p className={s.hint}>
        {tf.filtered.length === (dict.items ?? []).length ? `${tf.filtered.length} записей` : `${tf.filtered.length} из ${(dict.items ?? []).length} записей`}
      </p>

      {dict.error ? <p className={s.empty}>{dict.error.message}</p> : dict.loading ? <Skeleton lines={8} /> : (
        <div className={[s.tableWrapFill, s.hideOnMobile].join(' ')}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Название</th>
                {kind === 'companies' && <><th>Сегмент</th><th>Регион</th><th>Направления</th></>}
                {kind === 'positions' && <><th>Направления</th><th>Оклад Фаровона</th></>}
                <th>Использований</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tf.filtered.map(it => (
                <tr key={it.name}>
                  <td><button type="button" className={s.linkBtn} onClick={() => setEditing(it)}>{it.name}</button></td>
                  {isCompany(it) && <>
                    <td>{it.segment || '—'}</td>
                    <td>{it.region || '—'}</td>
                    <td className={s.wrapCell}>{it.dirs.join(', ') || '—'}</td>
                  </>}
                  {isPosition(it) && <>
                    <td className={s.wrapCell}>{it.dirs.join(', ') || '—'}</td>
                    <td>{it.payFrom || it.payTo ? `${it.payFrom || '—'} – ${it.payTo || '—'}` : '—'}</td>
                  </>}
                  <td>{it.used}</td>
                  <td>
                    {canEdit && <Button size="sm" variant="danger" onClick={() => handleDelete(it.name)}>Удалить</Button>}
                  </td>
                </tr>
              ))}
              {!tf.filtered.length && <tr><td colSpan={6} className={s.empty}>{(dict.items ?? []).length ? 'Ничего не найдено' : `Справочник «${meta.label}» пока пуст`}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Узкий экран: колонки в таблице зависят от вида справочника, на
          телефоне общие для всех — название и использования; остальное
          смотрят в самой карточке. Удаление — тоже туда (.mobileFormActions
          в DictItemForm), в компактной таблице для него нет колонки. */}
      {!dict.error && !dict.loading && (
        <div className={s.tableWrapFill}>
          <table className={s.tableCompact}>
            <thead><tr><th>Название</th><th>Использований</th></tr></thead>
            <tbody>
              {tf.filtered.map(it => (
                <tr key={it.name} className={s.clickableRow} onClick={() => setEditing(it)}>
                  <td>{it.name}</td>
                  <td>{it.used}</td>
                </tr>
              ))}
              {!tf.filtered.length && <tr><td colSpan={2} className={s.empty}>{(dict.items ?? []).length ? 'Ничего не найдено' : `Справочник «${meta.label}» пока пуст`}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DictItemForm
          kind={kind}
          item={editing === 'new' ? null : editing}
          dirOptions={dict.dirs}
          segmentOptions={(segmentsDict.items ?? []).map(i => i.name)}
          regionOptions={(regionsDict.items ?? []).map(i => i.name)}
          onClose={() => setEditing(null)}
          onSubmit={p => { dict.save(p); setEditing(null); }}
          onDelete={editing !== 'new' && canEdit ? () => { setEditing(null); handleDelete(editing.name); } : undefined}
        />
      )}

      {mergeOpen && (kind === 'companies' || kind === 'positions') && (
        <MergeDuplicates kind={kind} onClose={() => setMergeOpen(false)} />
      )}
    </div>
  );
}

function DictItemForm({ kind, item, dirOptions, segmentOptions, regionOptions, onClose, onSubmit, onDelete }: {
  kind: DictKind;
  item: DictItem | null;
  dirOptions: string[];
  segmentOptions: string[];
  regionOptions: string[];
  onClose: () => void;
  onSubmit: (p: { prev: string; name: string; segment?: string; region?: string; dirs?: string[]; payFrom?: number; payTo?: number }) => void;
  /** Только на узком экране — там компактная таблица не показывает колонку
      «Удалить» (DictionaryScreen.tsx, .tableCompact); на десктопе действие
      остаётся своей кнопкой в строке таблицы, .mobileFormActions скрывает
      эту от 768px. */
  onDelete?: () => void;
}) {
  const company = item && isCompany(item) ? item : null;
  const position = item && isPosition(item) ? item : null;
  const [name, setName] = useState(item?.name ?? '');
  const [segment, setSegment] = useState(company?.segment ?? '');
  const [region, setRegion] = useState(company?.region ?? '');
  const [dirs, setDirs] = useState<string[]>((company?.dirs ?? position?.dirs ?? []).slice());
  const [payFrom, setPayFrom] = useState(position?.payFrom ?? 0);
  const [payTo, setPayTo] = useState(position?.payTo ?? 0);

  function toggleDir(d: string) {
    setDirs(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  return (
    <Sheet open onClose={onClose} title={item ? item.name : 'Новая запись'}>
      <div className={s.form}>
        <Input label="Название" value={name} onChange={e => setName(e.target.value)} autoFocus />

        {kind === 'companies' && <>
          <Combobox label="Сегмент" value={segment} onChange={setSegment} options={segmentOptions.map(v => ({ value: v, label: v }))} placeholder="Выбрать сегмент" />
          <Combobox label="Регион" value={region} onChange={setRegion} options={regionOptions.map(v => ({ value: v, label: v }))} placeholder="Выбрать регион" />
        </>}

        {(kind === 'companies' || kind === 'positions') && (
          <div>
            <div className={s.hint} style={{ marginBottom: 4 }}>Направления</div>
            <div className={s.unitList}>
              {dirOptions.map(d => (
                <label key={d} className={s.unitRow}>
                  <input type="checkbox" checked={dirs.includes(d)} onChange={() => toggleDir(d)} />
                  {d}
                </label>
              ))}
              {!dirOptions.length && <span className={s.hint}>Направления не найдены</span>}
            </div>
          </div>
        )}

        {kind === 'positions' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Оклад Фаровона от, сомони" type="number" min={0} value={payFrom || ''} onChange={e => setPayFrom(Number(e.target.value) || 0)} />
            <Input label="Оклад Фаровона до, сомони" type="number" min={0} value={payTo || ''} onChange={e => setPayTo(Number(e.target.value) || 0)} />
          </div>
        )}

        <div className={s.formFoot}>
          {onDelete && (
            <div className={s.mobileFormActions}>
              <Button size="sm" variant="danger" onClick={onDelete}>Удалить</Button>
            </div>
          )}
          <Button
            disabled={!name.trim()}
            onClick={() => onSubmit({ prev: item?.name ?? '', name: name.trim(), segment, region, dirs, payFrom, payTo })}
          >
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
