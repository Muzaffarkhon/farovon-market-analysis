import { Badge, type BadgeTone } from '../../design/Badge';
import { Card } from '../../design/Card';
import type { PositionState } from '../../domain/progress';
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

export function PositionCard({ position, state, companies, onOpen }: {
  position: string;
  state: PositionState;
  companies: string[];
  onOpen: () => void;
}) {
  const shown = companies.slice(0, 3).join(', ');
  const rest = companies.length > 3 ? ` и ещё ${companies.length - 3}` : '';
  return (
    <Card onClick={onOpen} arrow>
      <div className={s.cardTop}>
        <span className={s.cardTitle}>{position}</span>
        <Badge tone={TONE[state.kind]}>{stateLabel(state)}</Badge>
      </div>
      {companies.length > 0 && <div className={s.cardSub}>{shown}{rest}</div>}
    </Card>
  );
}
