import { useMemo, useState } from 'react';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Sheet } from '../../design/Sheet';
import { normName } from '../../domain/progress';
import { useSessionData } from '../auth/useSession';
import s from './Survey.module.css';

/**
 * Шторка выбора компаний — бывший «Шаг 1», переехавший внутрь листа.
 * Отметил компанию — она сразу появилась карточкой для заполнения; выбор
 * сохраняется немедленно, без общей кнопки (ТЗ 3.1).
 */
export function CompanyPicker({ open, onClose, selected, poolCompanies, busy, onToggle, onAddNew }: {
  open: boolean;
  onClose: () => void;
  selected: string[];
  poolCompanies: string[];
  busy: boolean;
  onToggle: (company: string, checked: boolean) => void;
  onAddNew: (name: string) => void;
}) {
  const { companies } = useSessionData();
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; pool: boolean }[] = [];
    const push = (name: string, pool: boolean) => {
      const k = normName(name);
      if (!name || seen.has(k)) return;
      seen.add(k);
      out.push({ name, pool });
    };
    // Сначала пул подразделения и уже выбранные — они релевантнее справочника.
    selected.forEach(c => push(c, true));
    poolCompanies.forEach(c => push(c, true));
    companies.map(c => c.name).sort((a, b) => a.localeCompare(b, 'ru')).forEach(c => push(c, false));
    return out;
  }, [companies, poolCompanies, selected]);

  const q = search.trim();
  const shown = q ? list.filter(c => c.name.toLowerCase().includes(q.toLowerCase())) : list;
  const exact = list.some(c => normName(c.name) === normName(q));
  const isSelected = (name: string) => selected.some(c => normName(c) === normName(name));

  return (
    <Sheet open={open} onClose={onClose} title="Компании для сравнения">
      <Input label="Поиск" placeholder="Название компании" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
      {q && !exact && (
        <div style={{ margin: 'var(--s-3) 0' }}>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => { onAddNew(q); setSearch(''); }}>
            Добавить «{q}» в справочник
          </Button>
        </div>
      )}
      <div className={s.companyCol} style={{ marginTop: 'var(--s-3)' }}>
        {shown.map(c => (
          <label key={c.name} className={s.pickRow}>
            <input
              type="checkbox"
              // Явная подпись: обёртка <label> даёт её не во всех браузерах,
              // и в дереве доступности чекбокс оставался безымянным.
              aria-label={c.name}
              checked={isSelected(c.name)}
              disabled={busy}
              onChange={e => onToggle(c.name, e.target.checked)}
            />
            <span>{c.name}</span>
            {c.pool && <span className={s.poolMark}>в работе</span>}
          </label>
        ))}
        {!shown.length && !q && <p className={s.empty}>Справочник компаний пуст.</p>}
      </div>
    </Sheet>
  );
}
