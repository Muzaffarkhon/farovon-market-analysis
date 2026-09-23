import type { DashboardResponse } from '../../api/contract';
import { ForkBar } from '../../design/ForkBar';
import { KpiTile } from '../../design/KpiTile';
import { RankBar } from '../../design/RankBar';
import s from './Dashboard.module.css';

/**
 * Обзор: четыре плитки KPI, топ-6 должностей по числу наблюдений строками
 * вилки, рейтинг льгот сбоку — один в один как
 * `docs/presentation/mockups/04-dashboard.html`.
 */
export function OverviewTab({ data }: { data: DashboardResponse }) {
  const { summary, positions, topBenefits } = data;

  const withGap = positions.filter(p => p.gapPct != null);
  const avgGap = withGap.length
    ? Math.round(withGap.reduce((sum, p) => sum + (p.gapPct ?? 0), 0) / withGap.length)
    : null;

  const spreadPct = summary.salaryMedian > 0
    ? Math.round(((summary.salaryP75 - summary.salaryP25) / summary.salaryMedian) * 100)
    : 0;

  const withPremium = summary.totalSurveyRecords > 0
    ? Math.round((data.bonuses.hasBonus / summary.totalSurveyRecords) * 100)
    : 0;

  const top = [...positions].sort((a, b) => b.count - a.count).slice(0, 6);
  const domainMax = Math.max(1, ...top.map(p => p.max));

  return (
    <div>
      <div className={s.grid}>
        <KpiTile label="Медиана рынка (P50)" value={summary.salaryMedian.toLocaleString('ru-RU')} unit="сомони" />
        <KpiTile
          label="Фаровон к рынку" unit={avgGap != null ? '%' : undefined}
          value={avgGap != null ? (avgGap > 0 ? `+${avgGap}` : String(avgGap)) : '—'}
          tone={avgGap != null ? (avgGap < 0 ? 'warn' : 'ok') : undefined}
          hint="Средний гэп оклада Фаровона к медиане рынка по должностям, где известны оба"
        />
        <KpiTile label="Размах вилки" value={spreadPct} unit="%" hint="Между P25 и P75 от медианы" />
        <KpiTile label="Премируют" value={withPremium} unit="%" hint="Доля наблюдений с известной премией" />
      </div>

      <div className={s.overviewBody}>
        <div className={s.overviewMain}>
          <h3 className={s.sectionTitle}>Топ должностей по числу наблюдений</h3>
          {top.map(p => (
            <ForkBar key={p.pos} label={p.pos} stats={p} domainMax={domainMax} rightValue={p.median.toLocaleString('ru-RU')} />
          ))}
        </div>
        <div className={s.overviewSide}>
          <h3 className={s.sectionTitle}>Рейтинг льгот</h3>
          {topBenefits.slice(0, 5).map(b => (
            <RankBar key={b.name} label={b.name} pct={b.pct} />
          ))}
        </div>
      </div>
    </div>
  );
}
