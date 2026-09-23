import type { DashboardResponse } from '../../api/contract';
import { RankBar } from '../../design/RankBar';
import s from './Dashboard.module.css';

/** Топ-N записей словаря {имя: число} долями от суммы всех значений. */
function topShares(counts: Record<string, number>, n: number): { name: string; pct: number; count: number }[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }));
}

/** Рейтинг льгот целиком и переменная часть — доля с премией/без/неизвестно, топ видов и периодичность. */
export function BenefitsTab({ data }: { data: DashboardResponse }) {
  const { topBenefits, bonuses } = data;
  const bonusTotal = bonuses.hasBonus + bonuses.noBonus + bonuses.unknown;
  const bonusShare = (n: number) => (bonusTotal ? Math.round((n / bonusTotal) * 100) : 0);

  return (
    <div className={s.overviewBody}>
      <div className={s.overviewMain}>
        <h3 className={s.sectionTitle}>Рейтинг льгот</h3>
        {topBenefits.map(b => <RankBar key={b.name} label={b.name} pct={b.pct} count={b.count} />)}
        {!topBenefits.length && <p className={s.empty}>Льготы ещё не собраны.</p>}
      </div>
      <div className={s.overviewSide}>
        <h3 className={s.sectionTitle}>Переменная часть</h3>
        <RankBar label="Есть премия" pct={bonusShare(bonuses.hasBonus)} count={bonuses.hasBonus} />
        <RankBar label="Без премии" pct={bonusShare(bonuses.noBonus)} count={bonuses.noBonus} />
        <RankBar label="Не известно" pct={bonusShare(bonuses.unknown)} count={bonuses.unknown} />

        <h3 className={s.sectionTitle}>Виды премии</h3>
        {topShares(bonuses.types, 5).map(t => <RankBar key={t.name} label={t.name} pct={t.pct} count={t.count} />)}
        {!Object.keys(bonuses.types).length && <p className={s.empty}>Виды премии ещё не собраны.</p>}

        <h3 className={s.sectionTitle}>Периодичность</h3>
        {topShares(bonuses.periods, 5).map(p => <RankBar key={p.name} label={p.name} pct={p.pct} count={p.count} />)}
      </div>
    </div>
  );
}
