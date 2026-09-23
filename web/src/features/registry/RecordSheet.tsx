import { useNavigate } from 'react-router';
import type { RegistryRow } from '../../api/contract';
import { Button } from '../../design/Button';
import { Sheet } from '../../design/Sheet';
import { useSessionData } from '../auth/useSession';
import { scheduleLabel } from '../../domain/schedule';
import { money, payRange, perLabel, shortDate } from './format';
import s from './Registry.module.css';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className={s.recKey}>{label}</div>
      <div className={s.recVal}>{children}</div>
    </>
  );
}

/**
 * Карточка наблюдения. Всё, что собрано по строке, включая то, чего нет в
 * таблице: все виды переменной части, льготы списком, примечание.
 */
export function RecordSheet({ row, onClose }: { row: RegistryRow | null; onClose: () => void }) {
  const { user } = useSessionData();
  const navigate = useNavigate();
  if (!row) return null;

  const canFill = user.role === 'admin' || user.capabilities.includes('survey:fill');
  const openSurvey = () => {
    navigate(`/survey/${encodeURIComponent(row.unit)}/${encodeURIComponent(row.posOur)}`);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={row.company || 'Наблюдение'}
      footer={canFill && row.unit && row.posOur
        ? <Button onClick={openSurvey}>Открыть анкету</Button>
        : undefined}
    >
      <div className={s.rec}>
        <div className={s.recGrid}>
          <Row label="Дата">{shortDate(row.date)}</Row>
          <Row label="Кто собрал">{row.by || '—'}</Row>
          <Row label="Направление">{row.dir || '—'}</Row>
          <Row label="Подразделение">{row.unit || '—'}</Row>
          <Row label="Регион">{row.region || '—'}</Row>
          <Row label="Наша должность">{row.posOur || '—'}</Row>
          <Row label="У них">{row.posTheir || '—'}</Row>
          {row.grade && <Row label="Грейд">{row.grade}</Row>}
          <Row label="Оклад">{payRange(row)} <span className={s.muted}>{perLabel(row)}</span></Row>
          {row.totalMonthly != null && <Row label="Совокупно, мес.">≈ {money(row.totalMonthly)}</Row>}
          <Row label="График">{row.schedule ? scheduleLabel(row.schedule) : '—'}</Row>
          <Row label="Источник">{row.source || '—'}</Row>
          <Row label="Надёжность">{row.trust || '—'}</Row>
        </div>

        <div>
          <div className={s.recKey}>Переменная часть</div>
          {row.bonuses.length ? (
            <ul className={s.recList}>
              {row.bonuses.map((b, i) => (
                <li key={i}>{[b.type, b.size, b.per].filter(Boolean).join(' · ') || '—'}</li>
              ))}
            </ul>
          ) : (
            <div className={s.recVal}>{row.varPay.label || (row.bonHas === 'нет' ? 'без премии' : 'не указано')}</div>
          )}
          {row.varPay.monthlyKnown && row.varPay.monthly
            ? <div className={s.muted}>≈ {money(row.varPay.monthly)} в месяц</div>
            : null}
        </div>

        <div>
          <div className={s.recKey}>Льготы</div>
          {row.benefits.length
            ? <ul className={s.recList}>{row.benefits.map(b => <li key={b}>{b}</li>)}</ul>
            : <div className={s.recVal}>—</div>}
          {row.extra && <div className={s.recVal}>Прочие выплаты: {row.extra}</div>}
        </div>

        {row.note && (
          <div>
            <div className={s.recKey}>Примечание</div>
            <div className={s.recVal}>{row.note}</div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
