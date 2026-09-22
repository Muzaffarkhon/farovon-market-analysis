import { Badge, type BadgeTone } from '../../design/Badge';
import type { PositionState } from '../../domain/progress';
import { NoComparisonButton } from './NoComparisonButton';
import s from './Survey.module.css';

const TONE: Record<PositionState['kind'], BadgeTone> = {
  untouched: 'neutral', none: 'muted', partial: 'warn', done: 'ok'
};

/** Подпись бейджа: состояние видно с одного взгляда, без пояснений текстом. */
export function stateLabel(st: PositionState): string {
  if (st.kind === 'untouched') return 'не начата';
  if (st.kind === 'none') return 'не с кем';
  return `${st.done} из ${st.total}`;
}

export function PositionCard({ position, state, companies, busy, onOpen, onMarkNone, onClearNone }: {
  position: string;
  state: PositionState;
  companies: string[];
  busy: boolean;
  onOpen: () => void;
  onMarkNone: () => void;
  onClearNone: () => void;
}) {
  const shown = companies.slice(0, 3).join(', ');
  const rest = companies.length > 3 ? ` и ещё ${companies.length - 3}` : '';
  // Кнопка «не с кем» — только там, где решения ещё нет или оно именно такое:
  // у начатой должности она бессмысленна и только мешала бы. Карточка и кнопка
  // — соседи, а не вложенные кнопки (вложенность недопустима в разметке).
  const showAction = state.kind === 'untouched' || state.kind === 'none';

  return (
    <div className={s.posCard}>
      <button type="button" className={s.posMain} onClick={onOpen}>
        <span className={s.cardTop}>
          <span className={s.cardTitle}>{position}</span>
          <Badge tone={TONE[state.kind]}>{stateLabel(state)}</Badge>
        </span>
        {companies.length > 0 && <span className={s.cardSub}>{shown}{rest}</span>}
      </button>
      {showAction && (
        <div className={s.posAction}>
          <NoComparisonButton
            marked={state.kind === 'none'} busy={busy} size="sm" showBadge={false}
            onMark={onMarkNone} onClear={onClearNone}
          />
        </div>
      )}
      <span className={s.arrow} aria-hidden>›</span>
    </div>
  );
}
