import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { keyRisksApi } from '../../api/keyRisks';
import type { GradingFactor, KeyRisk } from '../../api/contract';
import { Button } from '../../design/Button';
import { Combobox } from '../../design/Combobox';
import { Select } from '../../design/Select';
import { Sheet } from '../../design/Sheet';
import { Textarea } from '../../design/Textarea';
import { useSessionData } from '../auth/useSession';
import s from './KeyRisks.module.css';

const FIELDS = ['bus_factor', 'replacement_time', 'knowledge_monopoly', 'financial_risk'] as const;

/**
 * Анкета риска незаменимости: подразделение → сотрудник (список, не
 * свободный текст — `unit-employees`) → четыре вопроса без весов. При
 * повторной оценке (`editing`) подразделение и сотрудник уже известны.
 */
export function RiskForm({ riskFactors, editing, onClose, onSubmit, submitting }: {
  riskFactors: GradingFactor[];
  editing: KeyRisk | null;
  onClose: () => void;
  onSubmit: (a: {
    unit: string; employee_fio: string; job_title: string;
    bus_factor: number; replacement_time: number; knowledge_monopoly: number; financial_risk: number;
    action_plan: string;
  }) => void;
  submitting: boolean;
}) {
  const { units } = useSessionData();
  const [unit, setUnit] = useState(editing?.unit ?? '');
  const [employeeFio, setEmployeeFio] = useState(editing?.employee_fio ?? '');
  const [jobTitle, setJobTitle] = useState(editing?.job_title ?? '');
  const [answers, setAnswers] = useState<Record<string, number>>({
    bus_factor: editing?.bus_factor ?? 0, replacement_time: editing?.replacement_time ?? 0,
    knowledge_monopoly: editing?.knowledge_monopoly ?? 0, financial_risk: editing?.financial_risk ?? 0
  });
  const [actionPlan, setActionPlan] = useState(editing?.action_plan ?? '');

  const employees = useQuery({
    queryKey: ['unit-employees', unit],
    queryFn: () => keyRisksApi.unitEmployees(unit),
    enabled: !!unit
  });

  // Смена подразделения без правки уже начатой карточки сбрасывает выбор
  // сотрудника — список employees принадлежит другому юниту.
  useEffect(() => {
    if (!editing) { setEmployeeFio(''); setJobTitle(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  // Должность подставляется сама при выборе сотрудника и не редактируется —
  // не блокируем кнопку её отсутствием (как старый клиент): у части
  // сотрудников в справочнике штата должность не заполнена, и решение,
  // заводить ли её, не в этой форме. Сервер откажет понятным текстом,
  // если её всё же не хватит.
  const canSubmit = !!unit && !!employeeFio && FIELDS.every(f => answers[f] > 0);

  return (
    <Sheet open onClose={onClose} title={editing ? editing.employee_fio : 'Оценить сотрудника'}>
      <div className={s.form}>
        <Combobox
          label="Подразделение" placeholder="— выберите —" value={unit} disabled={!!editing}
          options={units.map(u => ({ value: u.unit, label: u.unit }))}
          onChange={setUnit}
        />
        <Combobox
          label="Сотрудник" placeholder="— выберите —" value={employeeFio} disabled={!unit || !!editing}
          options={(employees.data?.rows ?? []).map(e => ({ value: e.fio, label: e.position ? e.fio : `${e.fio} (нет должности в карточке)` }))}
          onChange={v => {
            setEmployeeFio(v);
            const emp = employees.data?.rows.find(x => x.fio === v);
            if (emp) setJobTitle(emp.position);
          }}
        />
        {employeeFio && (
          <p className={s.jobTitleHint}>
            Должность: {jobTitle || 'не указана в справочнике штата — сервер откажет сохранить, пока её не заведут в «Пользователи» или карточке сотрудника'}
          </p>
        )}
        {riskFactors.map(f => (
          <Select
            key={f.code}
            label={f.title} placeholder="— выберите —"
            value={answers[FIELDS[riskFactors.indexOf(f)]] || ''}
            options={f.options.map((opt, i) => ({ value: String(i + 1), label: opt }))}
            onChange={e => setAnswers(prev => ({ ...prev, [FIELDS[riskFactors.indexOf(f)]]: Number(e.target.value) }))}
          />
        ))}
        <Textarea
          label="План действий (необязательно)" value={actionPlan}
          onChange={e => setActionPlan(e.target.value)}
          hint="Пусто — подставится типовая рекомендация по уровню риска"
        />
        <div className={s.formFoot}>
          <Button
            loading={submitting} disabled={!canSubmit}
            onClick={() => onSubmit({
              unit, employee_fio: employeeFio, job_title: jobTitle,
              bus_factor: answers.bus_factor, replacement_time: answers.replacement_time,
              knowledge_monopoly: answers.knowledge_monopoly, financial_risk: answers.financial_risk,
              action_plan: actionPlan
            })}
          >
            Сохранить оценку
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
