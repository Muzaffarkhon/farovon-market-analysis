import { useState } from 'react';
import type { SalaryEmployeeOption, SalaryReasonCode } from '../../api/contract';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Textarea } from '../../design/Textarea';
import { useCreateSalaryRequest, useSalaryEmployeeSearch, useSalaryReasons } from './useSalary';
import s from './Salary.module.css';

const fmt = new Intl.NumberFormat('ru-RU');

export function NewRequestForm() {
  const reasons = useSalaryReasons();
  const emp = useSalaryEmployeeSearch();
  const { create, creating } = useCreateSalaryRequest();

  const [selected, setSelected] = useState<SalaryEmployeeOption | null>(null);
  const [amount, setAmount] = useState('');
  const [percent, setPercent] = useState('');
  const [checked, setChecked] = useState<Set<SalaryReasonCode>>(new Set());
  const [reasonText, setReasonText] = useState('');

  function toggleReason(code: SalaryReasonCode) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  const canSubmit = !!selected && checked.size > 0 &&
    (amount.trim() !== '' || (percent.trim() !== '' && selected?.currentSalary)) &&
    (!checked.has('free_text') || reasonText.trim() !== '');

  function submit() {
    if (!selected || !canSubmit) return;
    create({
      unit: selected.unit, fio: selected.fio, position: selected.position,
      proposedSalary: amount.trim() ? Number(amount) : undefined,
      proposedPercent: percent.trim() ? Number(percent) : undefined,
      reasons: [...checked],
      reasonText: reasonText.trim() || undefined
    });
    setSelected(null); setAmount(''); setPercent(''); setChecked(new Set()); setReasonText(''); emp.setQuery('');
  }

  return (
    <div className={s.form}>
      {!selected ? (
        <div>
          <Input label="Сотрудник" placeholder="ФИО или подразделение" value={emp.query} onChange={e => emp.setQuery(e.target.value)} />
          <div className={s.list} style={{ marginTop: 'var(--s-2)' }}>
            {emp.rows.map(r => (
              <button key={r.id} type="button" className={s.listRow} onClick={() => setSelected(r)}>
                <span>{r.fio} <span className={s.hint}>· {r.unit}{r.position ? `, ${r.position}` : ''}</span></span>
                <span className={s.hint}>{r.currentSalary != null ? fmt.format(r.currentSalary) : 'оклад неизвестен'}</span>
              </button>
            ))}
            {!emp.rows.length && !emp.loading && <span className={s.hint}>Никого не найдено</span>}
          </div>
        </div>
      ) : (
        <>
          <div className={s.cardHead}>
            <div>
              <div className={s.cardTitle}>{selected.fio}</div>
              <div className={s.hint}>{selected.unit}{selected.position ? `, ${selected.position}` : ''}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Сменить</Button>
          </div>
          <div className={s.hint}>
            Текущий оклад: {selected.currentSalary != null ? fmt.format(selected.currentSalary) : 'не известен'}
          </div>

          <div className={s.row2}>
            <Input
              label="Новый оклад суммой" type="number" value={amount}
              onChange={e => { setAmount(e.target.value); if (e.target.value) setPercent(''); }}
            />
            <Input
              label="Или процентом повышения" type="number" value={percent}
              disabled={!selected.currentSalary}
              hint={!selected.currentSalary ? 'Недоступно — текущий оклад неизвестен' : undefined}
              onChange={e => { setPercent(e.target.value); if (e.target.value) setAmount(''); }}
            />
          </div>

          <div>
            <div className={s.hint} style={{ marginBottom: 4 }}>Основание</div>
            <div className={s.reasonList}>
              {reasons.map(r => (
                <label key={r.code} className={s.reasonRow}>
                  <input type="checkbox" checked={checked.has(r.code)} onChange={() => toggleReason(r.code)} />
                  {r.label}
                </label>
              ))}
            </div>
          </div>

          {checked.has('free_text') && (
            <Textarea label="Опишите причину" value={reasonText} onChange={e => setReasonText(e.target.value)} rows={3} />
          )}

          <div className={s.formFoot}>
            <Button loading={creating} disabled={!canSubmit} onClick={submit}>Отправить на согласование</Button>
          </div>
        </>
      )}
    </div>
  );
}
