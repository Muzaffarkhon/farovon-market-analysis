import { useState } from 'react';
import { Button } from '../../../design/Button';
import { Skeleton } from '../../../design/Skeleton';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { PeriodForm } from './PeriodForm';
import { PeriodGrantsPanel } from './PeriodGrantsPanel';
import { usePeriods } from './usePeriods';

export function PeriodsScreen() {
  useScreenTitle('Периоды сбора');
  const p = usePeriods();
  const [formAction, setFormAction] = useState<'new' | 'edit' | null>(null);

  if (p.error) return <p className={s.empty}>{p.error.message}</p>;
  if (p.loading) return <Skeleton lines={5} />;

  const periods = p.periods ?? [];
  const active = periods.find(row => row.isActive);

  return (
    <div>
      <div className={s.head}>
        {active?.state === 'закрыт' ? (
          <Button
            size="sm"
            onClick={() => {
              if (confirm('Открыть текущий период обратно? Период снова станет открытым, новый не создаётся.')) p.setPeriod({ action: 'reopen' });
            }}
          >
            Открыть текущий обратно
          </Button>
        ) : (
          <Button
            size="sm" variant="danger"
            onClick={() => {
              if (confirm('Закрыть период заполнения? Руководители перейдут в режим просмотра — вносить и удалять данные они больше не смогут.')) p.setPeriod({ action: 'close' });
            }}
          >
            Закрыть текущий период
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setFormAction('edit')}>Изменить текущий</Button>
        <Button size="sm" onClick={() => setFormAction('new')}>Открыть новый период</Button>
      </div>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>Период</th><th>Статус</th><th>Анкет</th><th></th></tr></thead>
          <tbody>
            {periods.map(row => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.isActive ? `Активен${row.state === 'закрыт' ? ' · закрыт' : ''}` : row.state}</td>
                <td>{row.surveysCount}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {!row.isActive && (
                    <Button
                      size="sm" variant="secondary"
                      onClick={() => {
                        if (confirm(`Текущим станет период «${row.name}» и он будет открыт. Прежний активный период станет архивным (данные сохранятся).`)) {
                          p.setPeriod({ action: 'activate', id: row.id });
                        }
                      }}
                    >
                      Сделать активным
                    </Button>
                  )}
                  {!row.isActive && (
                    <Button
                      size="sm" variant="danger" disabled={row.surveysCount > 0}
                      title={row.surveysCount > 0 ? 'В периоде есть анкеты — удалить нельзя' : undefined}
                      onClick={() => { if (confirm('Период пустой (0 анкет) — удаление необратимо. Удалить?')) p.remove(row.id); }}
                    >
                      Удалить
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 'var(--s-4)' }}>
        <PeriodGrantsPanel
          periods={periods} grants={p.grants ?? []} users={p.grantUsers ?? []}
          onGrant={p.grant} onRevoke={p.revokeGrant}
        />
      </div>

      {formAction && (
        <PeriodForm
          action={formAction}
          period={formAction === 'edit' ? (active ?? null) : null}
          onClose={() => setFormAction(null)}
          onSubmit={payload => { p.setPeriod(payload); setFormAction(null); }}
        />
      )}
    </div>
  );
}
