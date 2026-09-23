import { useState } from 'react';
import type { BenefitGroup } from '../../api/contract';
import { Badge } from '../../design/Badge';
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

/**
 * Льготы: частые — сразу на виду, остальные разделы свёрнуты в строки.
 * Раньше все 25 позиций восьми разделов были раскрыты разом и блок на
 * телефоне занимал больше экрана. Свёрнутый раздел показывает, что в нём
 * отмечено, — чтобы выбор не прятался вместе с разделом.
 */
export function BenefitsPicker({ groups, selected, onChange }: {
  groups: BenefitGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const has = (b: string) => selected.includes(b);
  const toggle = (b: string) => onChange(has(b) ? selected.filter(x => x !== b) : [...selected, b]);
  const known = new Set(groups.flatMap(g => g.items));
  const frequent = FREQUENT.filter(b => known.has(b));
  const frequentSet = new Set(frequent);
  const chip = (b: string) => <Chip key={b} active={has(b)} onClick={() => toggle(b)}>{b}</Chip>;

  return (
    <div className={s.companyCol}>
      {frequent.length > 0 && (
        <div className={s.chipGroup}>
          <div className={s.benefitHead}>
            <span className={s.chipGroupTitle}>Частые</span>
            <Button
              variant="ghost" size="sm"
              onClick={() => onChange(Array.from(new Set([...selected, ...frequent])))}
            >
              Отметить все
            </Button>
          </div>
          <div className={s.chips}>{frequent.map(chip)}</div>
        </div>
      )}
      <div className={s.benefitGroups}>
        {groups.map(g => {
          // Частые уже показаны выше — второй раз в разделе не повторяем.
          const items = g.items.filter(b => !frequentSet.has(b));
          if (!items.length) return null;
          const title = g.category || 'Другие льготы';
          const picked = items.filter(has);
          const isOpen = openGroup === title;
          return (
            <div key={title} className={s.benefitGroup}>
              <button
                type="button" className={s.benefitGroupHead} aria-expanded={isOpen}
                onClick={() => setOpenGroup(isOpen ? null : title)}
              >
                <span>{title}</span>
                <span className={s.benefitGroupMeta}>
                  {picked.length > 0 && <Badge tone="ok">{picked.length}</Badge>}
                  <span aria-hidden>{isOpen ? '▴' : '▾'}</span>
                </span>
              </button>
              {isOpen
                ? <div className={s.chips}>{items.map(chip)}</div>
                : picked.length > 0 && <div className={s.benefitPicked}>{picked.join(', ')}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
