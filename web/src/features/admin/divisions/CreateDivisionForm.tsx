import { useState } from 'react';
import type { CreateDivisionPayload } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';

export function CreateDivisionForm({ dirOptions, onClose, onSubmit, submitting }: {
  dirOptions: string[];
  onClose: () => void;
  onSubmit: (p: CreateDivisionPayload) => void;
  submitting: boolean;
}) {
  const [unit, setUnit] = useState('');
  const [dir, setDir] = useState('');
  const [head, setHead] = useState('');
  const [resp, setResp] = useState('');
  const [hrbp, setHrbp] = useState('');
  const [region, setRegion] = useState('');
  const [note, setNote] = useState('');

  return (
    <Sheet open onClose={onClose} title="Новое подразделение">
      <div className={s.form}>
        <Input label="Название" value={unit} onChange={e => setUnit(e.target.value)} />
        <Input label="Направление" list="admin-dir-options" value={dir} onChange={e => setDir(e.target.value)} hint="Пусто — «Без направления»" />
        <datalist id="admin-dir-options">{dirOptions.map(o => <option key={o} value={o} />)}</datalist>
        <Input label="Руководитель" value={head} onChange={e => setHead(e.target.value)} />
        <Input label="Ответственный" value={resp} onChange={e => setResp(e.target.value)} />
        <Input label="HRBP" value={hrbp} onChange={e => setHrbp(e.target.value)} />
        <Input label="Регион" value={region} onChange={e => setRegion(e.target.value)} />
        <Input label="Примечание" value={note} onChange={e => setNote(e.target.value)} />
        <div className={s.formFoot}>
          <Button loading={submitting} disabled={!unit.trim()} onClick={() => onSubmit({ unit: unit.trim(), dir, head, resp, hrbp, region, note })}>
            Создать
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
