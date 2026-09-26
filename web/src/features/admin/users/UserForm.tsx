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
export function UserForm({ editing, roles, unitOptions, onClose, onSubmit, submitting, onResetPassword, onArchive }: {
  editing: AdminUser | null;
  roles: RoleInfo[];
  unitOptions: string[];
  onClose: () => void;
  onSubmit: (p: SaveUserPayload) => void;
  submitting: boolean;
  /** Только для правки существующего — на узком экране таблица показывает
      лишь ФИО/роль/статус (UsersScreen.tsx, .tableCompact), эти два действия
      и не помещаются отдельной колонкой, и не показывались бы вовсе —
      переехали сюда, на десктопе они по-прежнему остаются в строке таблицы
      (.formFoot скрывает эти кнопки от 768px, см. Admin.module.css). */
  onResetPassword?: () => void;
  onArchive?: () => void;
}) {
  const [fio, setFio] = useState(editing?.fio ?? '');
  const [role, setRole] = useState<string>(editing?.role ?? 'user');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [position, setPosition] = useState(editing?.position ?? '');
  const [active, setActive] = useState(editing?.active ?? true);
  const [units, setUnits] = useState<string[]>(editing?.units ?? []);
  const [unitSearch, setUnitSearch] = useState('');

  const canSubmit = !!fio.trim();
  const q = unitSearch.trim().toLowerCase();
  const shownUnits = q ? unitOptions.filter(u => u.toLowerCase().includes(q)) : unitOptions;

  const toggleUnit = (u: string) => {
    setUnits(prev => prev.includes(u) ? prev.filter(x => x !== u) : [...prev, u]);
  };

  return (
    <Sheet open onClose={onClose} title={editing ? editing.fio : 'Новый пользователь'}>
      <div className={s.form}>
        {editing && (
          <div className={s.hint}>Telegram: {editing.hasTelegram ? 'есть' : 'нет'} · Последний вход: {editing.lastIn || '—'}</div>
        )}
        <Input label="ФИО" value={fio} onChange={e => setFio(e.target.value)} />
        <Select
          label="Роль" value={role} onChange={e => setRole(e.target.value)}
          options={roles.map(r => ({ value: r.key, label: r.label }))}
        />
        <Input label="Телефон" value={phone} onChange={e => setPhone(e.target.value)} />
        <Input label="Должность" value={position} onChange={e => setPosition(e.target.value)} />
        <div>
          <div className={s.hint} style={{ marginBottom: 4 }}>Подразделения</div>
          {unitOptions.length > 8 && (
            <div style={{ marginBottom: 'var(--s-2)' }}>
              <Input label="Поиск подразделения" value={unitSearch} onChange={e => setUnitSearch(e.target.value)} />
            </div>
          )}
          <div className={s.unitList}>
            {shownUnits.map(u => (
              <label key={u} className={s.unitRow}>
                <input type="checkbox" checked={units.includes(u)} onChange={() => toggleUnit(u)} />
                {u}
              </label>
            ))}
            {!unitOptions.length && <span className={s.hint}>Подразделения не найдены</span>}
            {!!unitOptions.length && !shownUnits.length && <span className={s.hint}>Ничего не найдено</span>}
          </div>
        </div>
        <label className={s.unitRow}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Активен
        </label>
        <div className={s.formFoot}>
          {(onResetPassword || onArchive) && (
            <div className={s.mobileFormActions}>
              {onResetPassword && <Button size="sm" variant="secondary" onClick={onResetPassword}>Сброс пароля</Button>}
              {onArchive && <Button size="sm" variant="danger" onClick={onArchive}>В архив</Button>}
            </div>
          )}
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
