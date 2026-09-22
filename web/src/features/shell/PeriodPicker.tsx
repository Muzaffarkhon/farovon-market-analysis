import { useSearchParams } from 'react-router';
import { useSessionData } from '../auth/useSession';
import { usePeriodId } from './usePeriodId';
import s from './Shell.module.css';

/** Текущий период — подписью; при наличии грантов на архив — выпадающий список. */
export function PeriodPicker() {
  const { period, myPeriodGrants } = useSessionData();
  const periodId = usePeriodId();
  const [params, setParams] = useSearchParams();

  if (!myPeriodGrants.length) {
    return <span className={s.period} title="Период сбора">{period.name}</span>;
  }
  const options = [{ id: '', name: period.name + ' (текущий)' }, ...myPeriodGrants.map(g => ({ id: String(g.periodId), name: g.periodName }))];
  return (
    <select
      className={s.periodSelect}
      aria-label="Период"
      value={periodId === null ? '' : String(periodId)}
      onChange={e => {
        const next = new URLSearchParams(params);
        if (e.target.value) next.set('period', e.target.value); else next.delete('period');
        setParams(next, { replace: true });
      }}
    >
      {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
