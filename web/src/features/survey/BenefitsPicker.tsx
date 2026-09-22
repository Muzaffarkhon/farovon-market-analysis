import type { BenefitGroup } from '../../api/contract';
import { Button } from '../../design/Button';
import { Chip } from '../../design/Chip';
import s from './Survey.module.css';

// Чаще всего встречающиеся позиции соцпакета — отмечаются одной кнопкой.
// Список перенесён из старого клиента (STD_BENEFITS).
const FREQUENT = [
  'Медицинское страхование (ДМС)', 'Оплата питания / Обеды',
  'Корпоративная мобильная связь', 'Обучение и тренинги за счет компании',
  'Корпоративный транспорт / развозка'
];

export function BenefitsPicker({ groups, selected, onChange }: {
  groups: BenefitGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const has = (b: string) => selected.includes(b);
  const toggle = (b: string) => onChange(has(b) ? selected.filter(x => x !== b) : [...selected, b]);
  const known = new Set(groups.flatMap(g => g.items));
  const frequent = FREQUENT.filter(b => known.has(b));

  return (
    <div className={s.companyCol}>
      {frequent.length > 0 && (
        <div>
          <Button
            variant="secondary" size="sm"
            onClick={() => onChange(Array.from(new Set([...selected, ...frequent])))}
          >
            Отметить частые
          </Button>
        </div>
      )}
      {groups.map(g => (
        <div key={g.category} className={s.chipGroup}>
          <span className={s.chipGroupTitle}>{g.category}</span>
          <div className={s.chips}>
            {g.items.map(b => (
              <Chip key={b} active={has(b)} onClick={() => toggle(b)}>{b}</Chip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
