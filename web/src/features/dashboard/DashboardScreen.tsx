import { NavLink } from 'react-router';
import type { DashboardResponse } from '../../api/contract';
import { Skeleton } from '../../design/Skeleton';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import { DashboardFilters } from './DashboardFilters';
import { BenchmarkTab } from './BenchmarkTab';
import { BenefitsTab } from './BenefitsTab';
import { OverviewTab } from './OverviewTab';
import { RegionsTab } from './RegionsTab';
import { SalariesTab } from './SalariesTab';
import { TABS, useDashboard } from './useDashboard';
import s from './Dashboard.module.css';

type TabProps = { data: DashboardResponse };

// Прогресс заполняется в следующей задаче плана; до тех пор — заглушка,
// чтобы раздел был проверяем целиком уже сейчас.
function ProgressTab(_: TabProps) { return <h2>Прогресс</h2>; }

const PANELS: Record<string, (props: TabProps) => React.JSX.Element> = {
  overview: OverviewTab, salaries: SalariesTab, regions: RegionsTab,
  benefits: BenefitsTab, benchmark: BenchmarkTab, progress: ProgressTab
};

export function DashboardScreen() {
  useScreenTitle('Дашборды');
  const d = useDashboard();
  const { user } = useSessionData();
  const canBenchmark = user.role === 'admin' || user.capabilities.includes('benchmarks:view');
  const tabs = TABS.filter(t => t.key !== 'benchmark' || canBenchmark);
  // Без права на вкладку прямая ссылка на неё не должна её показывать.
  const Panel = tabs.some(t => t.key === d.tab) ? PANELS[d.tab] : PANELS.overview;

  return (
    <div>
      <nav className={s.tabs} aria-label="Вкладки дашборда">
        {tabs.map(t => (
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
      {!d.isLoading && !d.error && d.data && d.data.summary.totalSurveyRecords > 0 && <Panel data={d.data} />}
    </div>
  );
}
