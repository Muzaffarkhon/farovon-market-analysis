import { useState } from 'react';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Sheet } from '../../design/Sheet';
import s from './Access.module.css';

export function CreateRoleForm({ onClose, onSubmit, submitting }: {
  onClose: () => void;
  onSubmit: (label: string) => void;
  submitting: boolean;
}) {
  const [label, setLabel] = useState('');

  return (
    <Sheet open onClose={onClose} title="Новая роль">
      <div className={s.panel}>
        <Input label="Название роли" value={label} onChange={e => setLabel(e.target.value)} />
        <div className={s.footer}>
          <Button loading={submitting} disabled={label.trim().length < 2} onClick={() => onSubmit(label.trim())}>
            Создать
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
