import { useState } from 'react';
import type { AdminUser, RoleInfo, SaveUserPayload } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';

/**
 * Логин не редактируется в форме: для новой записи сервер выпускает его сам
 * (fio → транслитерация), для правки — логин уже присвоен и передаётся
 * скрыто, только для того, чтобы отличить create от edit на сервере.
 */
export function UserForm({ editing, roles, unitOptions, onClose, onSubmit, submitting }: {
  editing: AdminUser | null;
  roles: RoleInfo[];
  unitOptions: string[];
  onClose: () => void;
  onSubmit: (p: SaveUserPayload) => void;
  submitting: boolean;
}) {
  const [fio, setFio] = useState(editing?.fio ?? '');
  const [role, setRole] = useState<string>(editing?.role ?? 'user');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [position, setPosition] = useState(editing?.position ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [units, setUnits] = useState<string[]>(editing?.units ?? []);

  const canSubmit = !!fio.trim();

  const toggleUnit = (u: string) => {
    setUnits(prev => prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]);
  };

  return (
    <Sheet open onClose={onClose} title={editing ? editing.fio : 'Новый пользователь'}>
      <div className={s.form}>
        <Input label="ФИО" value={fio} onChange={e => setFio(e.target.value)} />
        <Select
          label="Роль" value={role} onChange={e => setRole(e.target.value)}
          options={roles.map(r => ({ value: r.key, label: r.label }))}
        />
        <Input label="Телефон" value={phone} onChange={e => setPhone(e.target.value)} />
        <Input label="Должность" value={position} onChange={e => setPosition(e.target.value)} />
        <div>
          <div className={s.hint} style={{ marginBottom: 4 }}>Подразделения</div>
          <div className={s.unitList}>
            {unitOptions.map(u => (
              <label key={u} className={s.unitRow}>
                <input type="checkbox" checked={units.includes(u)} onChange={() => toggleUnit(u)} />
                {u}
              </label>
            ))}
            {!unitOptions.length && <span className={s.hint}>Подразделения не найдены</span>}
          </div>
        </div>
        <label className={s.unitRow}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Активен
        </label>
        <div className={s.formFoot}>
          <Button
            loading={submitting} disabled={!canSubmit}
            onClick={() => onSubmit({ login: editing?.login, fio: fio.trim(), role, phone, position, units, active })}
          >
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
