import { useState } from 'react';
import type { PeriodAction, PeriodRow, SetPeriodPayload } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';

const TITLES: Record<'new' | 'edit', string> = {
  new: 'Открыть новый период',
  edit: 'Изменить даты периода'
};

export function PeriodForm({ action, period, onClose, onSubmit }: {
  action: 'new' | 'edit';
  period: PeriodRow | null;
  onClose: () => void;
  onSubmit: (p: SetPeriodPayload) => void;
}) {
  const [name, setName] = useState(period?.name ?? '');
  const [from, setFrom] = useState(period?.fromDate ?? '');
  const [to, setTo] = useState(period?.toDate ?? '');
  const [state, setState] = useState(period?.state ?? 'открыт');

  return (
    <Sheet open onClose={onClose} title={TITLES[action]}>
      <div className={s.form}>
        {action === 'new' && (
          <p className={s.hint}>Начнётся новый год сбора с чистого листа. Данные закрытого периода останутся в архиве.</p>
        )}
        <Input label="Название периода" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Начало периода" type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <Input label="Окончание периода" type="date" value={to} onChange={e => setTo(e.target.value)} />
        {action === 'edit' && (
          <Select
            label="Статус" value={state} onChange={e => setState(e.target.value)}
            options={[{ value: 'открыт', label: 'Открыт' }, { value: 'закрыт', label: 'Закрыт' }]}
          />
        )}
        <div className={s.formFoot}>
          <Button
            disabled={action === 'new' && !name.trim()}
            onClick={() => onSubmit({ action: action as PeriodAction, name, from, to, state: action === 'edit' ? state : undefined })}
          >
            {action === 'new' ? 'Открыть период' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
