import type { Bonus, Ref } from '../../api/contract';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import s from './Survey.module.css';

/** У одного работодателя видов переменной части бывает несколько — список, а не одно поле. */
export function BonusesEditor({ bonuses, refs, onChange }: {
  bonuses: Bonus[];
  refs: Ref;
  onChange: (next: Bonus[]) => void;
}) {
  const update = (i: number, patch: Partial<Bonus>) =>
    onChange(bonuses.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  return (
    <div className={s.companyCol}>
      {bonuses.map((b, i) => (
        <div key={i} className={s.bonusRow}>
          <Select
            label="Вид" placeholder="— выберите —" value={b.type}
            options={refs.bonusTypes.map(v => ({ value: v, label: v }))}
            onChange={e => update(i, { type: e.target.value })}
          />
          <Input label="Размер" value={b.size} inputMode="text" placeholder="10% или 2000" onChange={e => update(i, { size: e.target.value })} />
          <Select
            label="Как часто" placeholder="— выберите —" value={b.per}
            options={refs.bonusPeriods.map(v => ({ value: v, label: v }))}
            onChange={e => update(i, { per: e.target.value })}
          />
          <Button variant="ghost" size="sm" aria-label={`Убрать вид ${i + 1}`} onClick={() => onChange(bonuses.filter((_, idx) => idx !== i))}>✕</Button>
        </div>
      ))}
      <div>
        <Button variant="secondary" size="sm" onClick={() => onChange([...bonuses, { type: '', size: '', per: '' }])}>
          Добавить вид
        </Button>
      </div>
    </div>
  );
}
