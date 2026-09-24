import { useState } from 'react';
import type { SalaryStep } from '../../api/contract';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { HistoryTab } from './HistoryTab';
import { NewRequestForm } from './NewRequestForm';
import { RequestQueue } from './RequestQueue';
import { useSalaryAccess } from './useSalary';
import s from './Salary.module.css';

const STEP_LABEL: Record<SalaryStep, string> = {
  cb_manager: 'Менеджер C&B',
  hrd: 'HRD',
  committee: 'Комиссия'
};

type Tab = 'new' | SalaryStep | 'history';

export function SalaryScreen() {
  useScreenTitle('Заявки на изменение зарплаты');
  const access = useSalaryAccess();
  const [tab, setTab] = useState<Tab | null>(null);

  if (access.loading) return <Skeleton lines={6} />;

  const tabs: { key: Tab; label: string }[] = [
    ...(access.canRequest ? [{ key: 'new' as Tab, label: 'Новая заявка' }] : []),
    ...access.steps.map(step => ({ key: step as Tab, label: `На согласовании — ${STEP_LABEL[step]}` })),
    { key: 'history' as Tab, label: 'История окладов' }
  ];

  if (!tabs.length) return <p className={s.empty}>Нет доступных вам разделов.</p>;
  const active = tab && tabs.some(t => t.key === tab) ? tab : tabs[0].key;

  return (
    <div>
      <div className={s.tabs}>
        {tabs.map(t => (
          <button key={t.key} type="button" className={[s.tab, active === t.key ? s.tabActive : ''].join(' ')} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {active === 'new' && <NewRequestForm />}
      {active === 'history' && <HistoryTab />}
      {access.steps.includes(active as SalaryStep) && <RequestQueue step={active as SalaryStep} />}
    </div>
  );
}
