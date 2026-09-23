import type { PositionStat } from '../../api/contract';
import { Sheet } from '../../design/Sheet';
import { money } from '../registry/format';
import s from './Dashboard.module.css';

/** Компании, давшие данные по должности, — по клику на строку вилки в «Зарплатных вилках». */
export function PositionSheet({ position, onClose }: { position: PositionStat | null; onClose: () => void }) {
  if (!position) return null;
  return (
    <Sheet open onClose={onClose} title={position.pos}>
      <div className={s.companyList}>
        {position.companies.map((c, i) => (
          <div key={i} className={s.companyRow}>
            <div className={s.companyTop}>
              <b>{c.company || '—'}</b>
              <span>{c.avg > 0 ? `${money(c.avg)} ${c.cur}` : '—'}</span>
            </div>
            <div className={s.companySub}>
              {c.varPay.label || '—'}
              {c.total != null && <> · совокупно ≈ {money(c.total)}</>}
            </div>
          </div>
        ))}
        {!position.companies.length && <p className={s.empty}>Нет данных по компаниям.</p>}
      </div>
    </Sheet>
  );
}
