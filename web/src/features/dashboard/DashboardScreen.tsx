import { NavLink } from 'react-router';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { DashboardFilters } from './DashboardFilters';
import { TABS, useDashboard } from './useDashboard';
import s from './Dashboard.module.css';

// Вкладки заполняются по одной в следующих задачах плана; до тех пор — место-
// заполнитель, чтобы раздел был проверяем целиком уже сейчас.
function OverviewTab() { return <h2>Обзор</h2>; }
function SalariesTab() { return <h2>Зарплатные вилки</h2>; }
function RegionsTab() { return <h2>По регионам</h2>; }
function BenefitsTab() { return <h2>Льготы и бонусы</h2>; }
function BenchmarkTab() { return <h2>Бенчмаркинг</h2>; }
function ProgressTab() { return <h2>Прогресс</h2>; }

const PANELS: Record<string, () => React.JSX.Element> = {
  overview: OverviewTab, salaries: SalariesTab, regions: RegionsTab,
  benefits: BenefitsTab, benchmark: BenchmarkTab, progress: ProgressTab
};

export function DashboardScreen() {
  useScreenTitle('Дашборды');
  const d = useDashboard();
  const Panel = PANELS[d.tab];

  return (
    <div>
      <nav className={s.tabs} aria-label="Вкладки дашборда">
        {TABS.map(t => (
          <NavLink
            key={t.key} to={`/dashboard/${t.key}`}
            className={({ isActive }) => [s.tab, isActive ? s.tabActive : ''].join(' ')}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <DashboardFilters d={d} />

      {d.error && <p className={s.empty}>{d.error.message}</p>}
      {d.isLoading && <Skeleton lines={6} />}
      {!d.isLoading && !d.error && d.data && d.data.summary.totalSurveyRecords === 0 && (
        <p className={s.empty}>За этот период ещё ничего не собрано.</p>
      )}
      {!d.isLoading && !d.error && d.data && d.data.summary.totalSurveyRecords > 0 && <Panel />}
    </div>
  );
}
