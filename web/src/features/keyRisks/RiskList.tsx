import type { KeyRisk } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { useSessionData } from '../auth/useSession';
import s from './KeyRisks.module.css';

const STATUS_LABEL: Record<KeyRisk['risk_status'], string> = {
  standard: 'Штатный', attention: 'Зона внимания', critical: 'Критический'
};

/** Оценённые сотрудники направления — как список должностей в грейдировании: строка на сотрудника, клик открывает анкету заново. */
export function RiskList({ rows, onEdit, onDelete }: {
  rows: KeyRisk[];
  onEdit: (row: KeyRisk) => void;
  onDelete: (id: number) => void;
}) {
  const { user } = useSessionData();
  const canDelete = user.role === 'admin';

  return (
    <div className={s.tableWrapFill}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th>Должность</th>
            <th>Подразделение</th>
            <th className={s.num}>Баллы</th>
            <th>Статус</th>
            {canDelete && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} onClick={() => onEdit(r)}>
              <td><b>{r.employee_fio}</b></td>
              <td>{r.job_title}</td>
              <td>{r.unit}</td>
              <td className={s.num}>{r.total_risk_score}</td>
              <td>
                <Badge tone={r.risk_status === 'standard' ? 'ok' : 'warn'}>
                  <span className={r.risk_status === 'critical' ? s.critical : undefined}>{STATUS_LABEL[r.risk_status]}</span>
                </Badge>
              </td>
              {canDelete && (
                <td>
                  <button
                    type="button" className={s.deleteBtn}
                    onClick={e => { e.stopPropagation(); onDelete(r.id); }}
                  >
                    Удалить
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className={s.empty}>В направлении пока никто не оценён.</p>}
    </div>
  );
}
