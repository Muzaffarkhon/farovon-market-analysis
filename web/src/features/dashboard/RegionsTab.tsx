import type { DashboardResponse } from '../../api/contract';
import { money } from '../registry/format';
import s from './Dashboard.module.css';

/** Вилки по регионам — таблицей, отсортировано по медиане (сервер уже сортирует). */
export function RegionsTab({ data }: { data: DashboardResponse }) {
  const rows = data.regionStats;
  if (!rows.length) return <p className={s.empty}>По выбранным фильтрам регион не определён ни у одной записи.</p>;

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>Регион</th>
            <th className={s.num}>Наблюдений</th>
            <th className={s.num}>Min</th>
            <th className={s.num}>P25</th>
            <th className={s.num}>Медиана</th>
            <th className={s.num}>P75</th>
            <th className={s.num}>Max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.region}>
              <td>{r.region}</td>
              <td className={s.num}>{r.count}</td>
              <td className={s.num}>{money(r.min)}</td>
              <td className={s.num}>{money(r.p25)}</td>
              <td className={s.num}><b>{money(r.median)}</b></td>
              <td className={s.num}>{money(r.p75)}</td>
              <td className={s.num}>{money(r.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
