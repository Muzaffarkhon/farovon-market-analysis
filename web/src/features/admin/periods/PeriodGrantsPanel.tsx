import { useState } from 'react';
import type { PeriodGrantRow, PeriodGrantUser, PeriodRow } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Combobox } from '../../../design/Combobox';
import { Select } from '../../../design/Select';
import s from '../Admin.module.css';

/** Точечный доступ на редактирование закрытого/архивного периода — на сутки, продлевается повторной выдачей. */
export function PeriodGrantsPanel({ periods, grants, users, onGrant, onRevoke }: {
  periods: PeriodRow[];
  grants: PeriodGrantRow[];
  users: PeriodGrantUser[];
  onGrant: (a: { userLogin: string; periodId: number }) => void;
  onRevoke: (a: { userLogin: string; periodId: number }) => void;
}) {
  const archivedPeriods = periods.filter(p => !p.isActive);
  const [userLogin, setUserLogin] = useState(users[0]?.login ?? '');
  const [periodId, setPeriodId] = useState(archivedPeriods[0]?.id ?? 0);

  return (
    <div>
      <h4 className={s.hint}>Доступ к редактированию архивных периодов</h4>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>Сотрудник</th><th>Период</th><th>Истекает</th><th></th></tr></thead>
          <tbody>
            {grants.map(g => (
              <tr key={g.userLogin + '|' + g.periodId}>
                <td>{g.userFio}</td><td>{g.periodName}</td><td>{g.expiresAt}</td>
                <td><Button size="sm" variant="danger" onClick={() => onRevoke({ userLogin: g.userLogin, periodId: g.periodId })}>Отозвать</Button></td>
              </tr>
            ))}
            {!grants.length && <tr><td colSpan={4} className={s.empty}>Действующих грантов нет</td></tr>}
          </tbody>
        </table>
      </div>

      {archivedPeriods.length > 0 && (
        <div className={s.formFoot} style={{ justifyContent: 'flex-start', marginTop: 'var(--s-3)' }}>
          <Combobox label="Сотрудник" value={userLogin} onChange={setUserLogin} options={users.map(u => ({ value: u.login, label: u.fio }))} />
          <Select label="Период" value={String(periodId)} onChange={e => setPeriodId(Number(e.target.value))} options={archivedPeriods.map(p => ({ value: String(p.id), label: p.name }))} />
          <Button disabled={!userLogin || !periodId} onClick={() => onGrant({ userLogin, periodId })}>Выдать на сутки</Button>
        </div>
      )}
    </div>
  );
}
