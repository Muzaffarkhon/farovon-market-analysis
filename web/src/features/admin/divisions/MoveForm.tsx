import { useState } from 'react';
import type { Division, MoveDivisionPayload } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';

export function MoveForm({ division, onClose, onSubmit }: {
  division: Division;
  onClose: () => void;
  onSubmit: (p: MoveDivisionPayload) => void;
}) {
  const [targetDir, setTargetDir] = useState(division.dir ?? '');
  const [parentUnit, setParentUnit] = useState(division.parent_unit ?? '');

  return (
    <Sheet open onClose={onClose} title={`Переместить «${division.unit}»`}>
      <div className={s.form}>
        <Input label="Новое направление" value={targetDir} onChange={e => setTargetDir(e.target.value)} />
        <Input
          label="Родительское подразделение (необязательно)" value={parentUnit}
          onChange={e => setParentUnit(e.target.value)}
          hint="Заполните, если это подотдел внутри другого подразделения"
        />
        <div className={s.formFoot}>
          <Button
            disabled={!targetDir.trim()}
            onClick={() => onSubmit({ unit: division.unit, targetDir: targetDir.trim(), parentUnit: parentUnit.trim() || null })}
          >
            Переместить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
