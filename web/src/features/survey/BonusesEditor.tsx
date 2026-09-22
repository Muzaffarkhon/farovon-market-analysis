import type { Bonus, Ref } from '../../api/contract';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { bonusRowGaps } from '../../domain/validation';
import s from './Survey.module.css';

/** У одного работодателя видов переменной части бывает несколько — список, а не одно поле. */
export function BonusesEditor({ bonuses, refs, error, onChange }: {
  bonuses: Bonus[];
  refs: Ref;
  /** Текст ошибки по блоку премий; заодно включает подсветку пустых полей. */
  error?: string;
  onChange: (next: Bonus[]) => void;
}) {
  const update = (i: number, patch: Partial<Bonus>) =>
    onChange(bonuses.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  return (
    <div className={s.companyCol}>
      {bonuses.map((b, i) => {
        // Подсвечиваем именно незаполненное поле строки: общей подписи под
        // списком мало, когда видов несколько.
        const gap = error ? bonusRowGaps(b) : { type: false, size: false, per: false };
        return (
          <div key={i} className={s.bonusRow}>
            <Select
              label="Вид" placeholder="— выберите —" value={b.type} invalid={gap.type}
              options={refs.bonusTypes.map(v => ({ value: v, label: v }))}
              onChange={e => update(i, { type: e.target.value })}
            />
            <Input
              label="Размер" value={b.size} inputMode="text" placeholder="10% или 2000" invalid={gap.size}
              onChange={e => update(i, { size: e.target.value })}
            />
            <Select
              label="Как часто" placeholder="— выберите —" value={b.per} invalid={gap.per}
              options={refs.bonusPeriods.map(v => ({ value: v, label: v }))}
              onChange={e => update(i, { per: e.target.value })}
            />
            <Button variant="ghost" size="sm" aria-label={`Убрать вид ${i + 1}`} onClick={() => onChange(bonuses.filter((_, idx) => idx !== i))}>✕</Button>
          </div>
        );
      })}
      {error && <div className={s.bonusError}>{error}</div>}
      <div>
        <Button variant="secondary" size="sm" onClick={() => onChange([...bonuses, { type: '', size: '', per: '' }])}>
          Добавить вид
        </Button>
      </div>
    </div>
  );
}
