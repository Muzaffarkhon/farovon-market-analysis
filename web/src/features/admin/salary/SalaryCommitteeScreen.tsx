import { useState } from 'react';
import { Button } from '../../../design/Button';
import { Combobox } from '../../../design/Combobox';
import { useConfirm } from '../../../design/Confirm';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { useSalaryCommittee } from './useSalaryCommittee';

/**
 * Комиссия по заявкам на изменение зарплаты — глобальная, не по блокам (в
 * отличие от грейдинга): решает единогласно, любой отказ отклоняет заявку.
 */
export function SalaryCommitteeScreen() {
  useScreenTitle('Заявки на зарплату — комиссия');
  const c = useSalaryCommittee();
  const confirm = useConfirm();
  const [login, setLogin] = useState('');

  return (
    <div data-wide>
      <h4 className={s.hint}>Состав комиссии — решает единогласно, отказ любого члена отклоняет заявку</h4>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>ФИО</th><th>Логин</th><th></th></tr></thead>
          <tbody>
            {c.members.map(m => (
              <tr key={m.login}>
                <td>{m.fio}</td><td>{m.login}</td>
                <td>
                  <Button
                    size="sm" variant="danger"
                    onClick={async () => { if (await confirm({ message: `Исключить «${m.fio}» из комиссии?`, danger: true })) c.remove(m.login); }}
                  >
                    Исключить
                  </Button>
                </td>
              </tr>
            ))}
            {!c.members.length && <tr><td colSpan={3} className={s.empty}>Комиссия не назначена</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={s.formFoot} style={{ justifyContent: 'flex-start', marginTop: 'var(--s-3)' }}>
        <Combobox label="Сотрудник" value={login} onChange={setLogin} options={c.userOptions} placeholder="Начните вводить ФИО или логин" />
        <Button disabled={!login.trim()} onClick={() => { c.add(login.trim()); setLogin(''); }}>Добавить в комиссию</Button>
      </div>
    </div>
  );
}
