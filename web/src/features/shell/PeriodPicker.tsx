import { useSearchParams } from 'react-router';
import { useSessionData } from '../auth/useSession';
import { usePeriodId } from './usePeriodId';
import s from './Shell.module.css';

/**
 * Текущий период — подписью; при наличии грантов на архив — выпадающий список.
 * variant «bar» — в самой шапке (видна только на десктопе, Shell.module.css);
 * variant «menu» — тот же выбор, но строкой в меню «Ещё» на телефоне: сам
 * select в шапке там не помещался и раздувал её до переноса заголовка на
 * две строки.
 * variant «inline» — та же строка меню, но без своих отступов: используется
 * в Sidebar.tsx рядом с именем пользователя в одном ряду, отступ и фон
 * задаёт сам ряд-обёртка (.accountRow).
 */
export function PeriodPicker({ variant = 'bar' }: { variant?: 'bar' | 'menu' | 'inline' }) {
  const { period, myPeriodGrants } = useSessionData();
  const periodId = usePeriodId();
  const [params, setParams] = useSearchParams();

  if (!myPeriodGrants.length) {
    if (variant === 'inline') return <span>Период: {period.name}</span>;
    return variant === 'menu'
      ? <div className={s.periodInMenu}>Период: {period.name}</div>
      : <span className={s.period} title="Период сбора">{period.name}</span>;
  }
  const options = [{ id: '', name: period.name + ' (текущий)' }, ...myPeriodGrants.map(g => ({ id: String(g.periodId), name: g.periodName }))];
  return (
    <select
      className={variant === 'inline' ? s.periodSelectInline : variant === 'menu' ? s.periodSelectMenu : s.periodSelect}
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
