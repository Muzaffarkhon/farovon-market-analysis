import { useState } from 'react';
import type { BatchAssignPayload } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';

const ROLE_TYPES = [
  { value: 'head', label: 'Руководитель' },
  { value: 'resp', label: 'Ответственный' },
  { value: 'hrbp', label: 'HRBP' }
];

/** Одна форма на редкую операцию — назначить одно и то же лицо на всё направление сразу. */
export function BatchAssignForm({ dirOptions, onClose, onSubmit, submitting }: {
  dirOptions: string[];
  onClose: () => void;
  onSubmit: (p: BatchAssignPayload) => void;
  submitting: boolean;
}) {
  const [dir, setDir] = useState(dirOptions[0] ?? '');
  const [roleType, setRoleType] = useState<BatchAssignPayload['roleType']>('head');
  const [personName, setPersonName] = useState('');

  return (
    <Sheet open onClose={onClose} title="Массовое назначение по направлению">
      <div className={s.form}>
        <Select label="Направление" value={dir} onChange={e => setDir(e.target.value)} options={dirOptions.map(d => ({ value: d, label: d }))} />
        <Select
          label="Роль" value={roleType}
          onChange={e => setRoleType(e.target.value as BatchAssignPayload['roleType'])}
          options={ROLE_TYPES}
        />
        <Input label="ФИО" value={personName} onChange={e => setPersonName(e.target.value)} hint="Пусто — снять назначение со всех подразделений направления" />
        <div className={s.formFoot}>
          <Button loading={submitting} disabled={!dir} onClick={() => onSubmit({ dir, roleType, personName })}>
            Применить ко всему направлению
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
