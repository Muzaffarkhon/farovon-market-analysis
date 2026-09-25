import { useState } from 'react';
import type { CompEmployeeOption, CompReasonCode, CompRequestType } from '../../api/contract';
import { Button } from '../../design/Button';
import { Combobox } from '../../design/Combobox';
import { Input } from '../../design/Input';
import { Textarea } from '../../design/Textarea';
import { useCompReasons, useEmployeeSearch, usePositionOptions } from './useCompReview';
import s from './CompReview.module.css';

const fmt = new Intl.NumberFormat('ru-RU');

type AddPayload = {
  fio: string; unit: string; position?: string; newPosition?: string; staffId?: number;
  proposedSalary: number; reasonCode: CompReasonCode; reasonText?: string;
  hireDate?: string; probationStartDate?: string; probationEndDate?: string;
};

export function EmployeeAddForm({ onAdd, adding, unit, requestType }: {
  onAdd: (a: AddPayload) => void;
  adding: boolean;
  /** Подразделение из шапки заявки — список ниже сразу фильтруется по нему, без ручного набора. */
  unit?: string;
  /** «Выход из стажировки» просит даты начала/окончания стажировки вместо даты выхода на работу. */
  requestType?: CompRequestType;
}) {
  const { reasons } = useCompReasons();
  const emp = useEmployeeSearch(unit);
  const positionOptions = usePositionOptions();
  const [selected, setSelected] = useState<CompEmployeeOption | null>(null);
  const [proposedSalary, setProposedSalary] = useState('');
  const [reasonCode, setReasonCode] = useState<CompReasonCode | ''>('');
  const [reasonText, setReasonText] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [probationStartDate, setProbationStartDate] = useState('');
  const [probationEndDate, setProbationEndDate] = useState('');
  const [newPosition, setNewPosition] = useState('');
  const isProbation = requestType === 'probation_end';

  const canSubmit = !!selected && Number(proposedSalary) > 0 && !!reasonCode;

  function submit() {
    if (!selected || !canSubmit) return;
    onAdd({
      fio: selected.fio, unit: selected.unit, position: selected.position, staffId: selected.id,
      newPosition: newPosition.trim() || undefined,
      proposedSalary: Number(proposedSalary), reasonCode: reasonCode as CompReasonCode, reasonText: reasonText.trim() || undefined,
      hireDate: hireDate || undefined, probationStartDate: probationStartDate || undefined, probationEndDate: probationEndDate || undefined
    });
    setSelected(null); setProposedSalary(''); setReasonCode(''); setReasonText('');
    setHireDate(''); setProbationStartDate(''); setProbationEndDate(''); setNewPosition(''); emp.setQuery('');
  }

  if (!selected) {
    return (
      <div>
        <Input
          label="Добавить сотрудника" value={emp.query} onChange={e => emp.setQuery(e.target.value)}
          placeholder={unit ? 'Уточнить по ФИО (необязательно)' : 'ФИО или подразделение'}
        />
        <div className={s.searchList} style={{ marginTop: 'var(--s-2)' }}>
          {emp.rows.map(r => (
            <button key={r.id} type="button" className={s.searchRow} onClick={() => setSelected(r)}>
              <span>{r.fio} <span className={s.hint}>· {r.unit}{r.position ? `, ${r.position}` : ''}</span></span>
              <span className={s.hint}>{r.currentSalary != null ? fmt.format(r.currentSalary) : 'оклад неизвестен'}</span>
            </button>
          ))}
          {!emp.rows.length && !emp.loading && <span className={s.hint}>Никого не найдено</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>{selected.fio}</div>
          <div className={s.hint}>{selected.unit}{selected.position ? `, ${selected.position}` : ''} · текущий оклад: {selected.currentSalary != null ? fmt.format(selected.currentSalary) : 'не известен'}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Сменить</Button>
      </div>
      <Input label="Предлагаемый оклад" type="number" value={proposedSalary} onChange={e => setProposedSalary(e.target.value)} />
      <Combobox
        label="Назначаемая должность (только при переводе)" options={positionOptions.options} loading={positionOptions.loading}
        value={newPosition} onChange={setNewPosition}
      />
      {isProbation ? (
        <div className={s.vpRow}>
          <Input label="Дата начала стажировки" type="date" value={probationStartDate} onChange={e => setProbationStartDate(e.target.value)} />
          <Input label="Дата окончания стажировки" type="date" value={probationEndDate} onChange={e => setProbationEndDate(e.target.value)} />
        </div>
      ) : (
        <Input label="Дата выхода на работу" type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} />
      )}
      <div>
        <div className={s.hint} style={{ marginBottom: 4 }}>Код основания</div>
        <div className={s.reasonList}>
          {reasons.map(r => (
            <label key={r.code} className={s.reasonRow}>
              <input type="radio" name="reasonCode" checked={reasonCode === r.code} onChange={() => setReasonCode(r.code as CompReasonCode)} />
              {r.label}
            </label>
          ))}
        </div>
      </div>
      <Textarea label="Обоснование (обязательно для исключения из правила 6 месяцев)" value={reasonText} onChange={e => setReasonText(e.target.value)} rows={2} />
      <div className={s.formFoot}>
        <Button loading={adding} disabled={!canSubmit} onClick={submit}>Добавить в заявку</Button>
      </div>
    </div>
  );
}
