import type { KeyRisk } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { useSessionData } from '../auth/useSession';
import s from './KeyRisks.module.css';

/** Требуют внимания — attention и critical вместе, отсортировано по баллу убыв. (собрано в useKeyRisks). */
export function RiskList({ rows, onEdit, onDelete }: {
  rows: KeyRisk[];
  onEdit: (row: KeyRisk) => void;
  onDelete: (id: number) => void;
}) {
  const { user } = useSessionData();
  const canDelete = user.role === 'admin';

  return (
    <div className={s.list}>
      {rows.map(r => (
        <div key={r.id} className={s.riskRow}>
          <div className={s.riskMain}>
            <div className={s.riskTop}>
              <b>{r.employee_fio}</b>
              <Badge tone="warn">
                <span className={r.risk_status === 'critical' ? s.critical : undefined}>{r.total_risk_score} баллов</span>
              </Badge>
            </div>
            <div className={s.riskMeta}>{r.job_title} · {r.unit}</div>
            {r.action_plan && <div className={s.riskPlan}>{r.action_plan}</div>}
          </div>
          <div className={s.riskActions}>
            <Button variant="secondary" size="sm" onClick={() => onEdit(r)}>Оценить заново</Button>
            {canDelete && <Button variant="danger" size="sm" onClick={() => onDelete(r.id)}>Удалить</Button>}
          </div>
        </div>
      ))}
      {!rows.length && <p className={s.empty}>Никто не требует особого внимания.</p>}
    </div>
  );
}
